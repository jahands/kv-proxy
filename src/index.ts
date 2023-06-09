import { Hono } from 'hono'
import type { App, Bindings, R2Buckets } from './types'
import { initSentry } from './sentry'

const app = new Hono<App>()

// Sentry
app
	.use(async (c, next) => {
		c.set('sentry', initSentry(c.req.raw, c.env, c.executionCtx))
		await next()
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

function getBucket(name: string, env: Bindings): R2Bucket | null {
	switch (name as R2Buckets) {
		case 'eemailme-kv':
			return env.EEMAILMEKV
		default:
			return null
	}
}

// KV app that has the kv bucket set
const kvApp = new Hono<App & { Variables: { bucket: R2Bucket } }>()
	.use('/:bucket/:key{.*}', async (c, next) => {
		const bucketName = c.req.param('bucket')
		const bucket = getBucket(bucketName, c.env)
		if (!bucket) {
			return c.text('invalid bucket', 400)
		}
		c.set('bucket', bucket)
		await next()
	})

	.get('/:bucket/:key{.*}', async (c) => {
		const key = c.req.param('key')
		const kvRes = await c.get('bucket').get(key)
		if (!kvRes) {
			return c.notFound()
		}

		c.header(
			'Content-Type',
			kvRes.httpMetadata?.contentType || 'application/octet-stream'
		)
		c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
		const response = c.body(await kvRes.arrayBuffer())

		return response
	})

	.put(async (c) => {
		const key = c.req.param('key')
		const contentType = c.req.headers.get('Content-Type')
		if (!contentType) {
			return c.text('missing content-type header', 400)
		}

		const body = await c.req.arrayBuffer()
		await c.get('bucket').put(key, body, {
			httpMetadata: {
				contentType,
			},
		})
		return c.body(null, 200)
	})

	.delete(async (c) => {
		const key = c.req.param('key')
		await c.get('bucket').delete(key)
		return c.body(null, 200)
	})

app.route('/v1', kvApp)

export default app
