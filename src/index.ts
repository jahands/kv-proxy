import { Hono } from 'hono'
import type { App, Bindings, R2Buckets } from './types'
import { initSentry } from './sentry'

const app = new Hono<App>()

// Sentry
app
	.use(async (c, next) => {
		c.set('sentry', initSentry(c.req.raw, c.env, c.executionCtx))
		await next()
		if (c.error) {
			c.get('sentry').captureException(c.error)
		}
	})
	.onError((err, c) => {
		c.get('sentry').captureException(err)
		return c.text('internal server error', 500)
	})

// Auth all routes
app.use(async (c, next) => {
	const { key } = c.req.query()
	const headersKey = c.req.headers.get('x-api-key')
	if (![key, headersKey].includes(c.env.API_KEY)) {
		return c.text('unauthorized', 401)
	}
	await next()
})

function getNamespace(name: string, env: Bindings): R2Bucket | null {
	switch (name as R2Buckets) {
		case 'eemailme':
			return env.EEMAILMEKV
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

// KV app that has the kv namespace set
const kvApp = new Hono<App & { Variables: { kv: R2Bucket } }>()
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
		const kvRes = await c.get('kv').get(key)
		if (!kvRes) {
			return c.notFound()
		}

		c.header(
			'Content-Type',
			kvRes.httpMetadata?.contentType || 'application/octet-stream'
		)
		c.header('Cache-Control', 'public, max-age=60, s-maxage=60')
		const response = c.body(await kvRes.arrayBuffer())

		c.executionCtx.waitUntil(cache.put(c.req.url, response.clone()))
		return response
	})

	.put(async (c) => {
		const key = c.req.param('key')
		const contentType = c.req.headers.get('Content-Type')
		if (!contentType) {
			return c.text('missing content-type header', 400)
		}

		const body = await c.req.arrayBuffer()
		await c.get('kv').put(key, body, {
			httpMetadata: {
				contentType,
			},
		})
		return c.body(null, 200)
	})

	.delete(async (c) => {
		const key = c.req.param('key')
		await c.get('kv').delete(key)
		return c.body(null, 200)
	})

app.route('/v1', kvApp)

export default app
