import { Hono } from 'hono'
import type { App, Bindings, KVNamespaces } from './types'
import { initSentry } from './sentry'

const app = new Hono<App>()

// Sentry
app.use(async (c, next) => {
	c.set('sentry', initSentry(c.req.raw, c.env, c.executionCtx))
	await next()
	if (c.error) {
		c.get('sentry').captureException(c.error)
	}
})

app.onError((err, c) => {
	c.get('sentry').captureException(err)
	return c.text('internal server error', 500)
})

// Auth all routes
app.use(async (c, next) => {
	const { key } = c.req.query()
	if (key !== c.env.API_KEY) {
		return c.text('unauthorized', 401)
	}
	await next()
})

function getNamespace(name: string, env: Bindings): KVNamespace | null {
	switch (name as KVNamespaces) {
		case 'eemailme':
			return env.EEMAILME
		default:
			return null
	}
}

/** metadata for kv data */
interface kvMetadata {
	headers: {
		'Content-Type': string
	}
}

// Sub app that has the kv namespace set. I didn't really need to do
// this because we're mounting on / anyway. But I wanted to learn how
// to compose apps.
const kvApp = new Hono<App & { Variables: { kv: KVNamespace } }>()
	.use('/:namespace/:key{.*}', async (c, next) => {
		const namespaceName = c.req.param('namespace')
		const kv = getNamespace(namespaceName, c.env)
		if (!kv) {
			return c.text('invalid namespace', 400)
		}
		c.set('kv', kv)
		await next()
	})

	.get('/:namespace/:key{.*}', async (c) => {
		const cache = caches.default
		const match = await cache.match(c.req.url)
		if (match) {
			return match
		}

		const key = c.req.param('key')
		const kvRes = await c
			.get('kv')
			.getWithMetadata<kvMetadata>(key, 'arrayBuffer')
		if (!kvRes) {
			return c.notFound()
		}

		c.header(
			'Content-Type',
			kvRes.metadata?.headers['Content-Type'] || 'application/octet-stream'
		)
		const response = c.body(kvRes.value)

		c.executionCtx.waitUntil(cache.put(c.req.url, response.clone()))
		return response
	})

	.put(async (c) => {
		const key = c.req.param('key')
		const contentType = c.req.headers.get('Content-Type')
		if (!contentType) {
			return c.text('missing content-type header', 400)
		}

		const metadata: kvMetadata = {
			headers: {
				'Content-Type': contentType,
			},
		}

		const body = await c.req.arrayBuffer()
		await c.get('kv').put(key, body, {
			metadata,
		})
		return c.body(null, 200)
	})

	.delete(async (c) => {
		const key = c.req.param('key')
		await c.get('kv').delete(key)
		return c.body(null, 200)
	})

app.route('/', kvApp)

export default app
