import { Hono } from 'hono'
import '@sentry/tracing'
import type { App, Bindings, R2Buckets } from './types'
import { initSentry } from './sentry'
import { getCFTrace } from './trace'

const app = new Hono<App>()
	// Sentry
	.use(async (c, next) => {
		const sentry = initSentry(c.req.raw, c.env, c.executionCtx)
		c.set('sentry', sentry)
		try {
			const t = await getCFTrace()
			const cf = c.req.raw.cf
			sentry.configureScope((scope) => {
				scope.addAttachment({
					filename: 'cf.json',
					contentType: 'application/json',
					data: JSON.stringify({ cfTrace: t, 'request.cf': cf }),
				})
				scope.setTags({
					colo: t.colo,
					loc: t.loc,
					// Trying to see if these are ever different
					cfColo: (cf?.colo || '').toString(),
					cfLoc: (cf?.country || '').toString(),
				})
			})
		} catch (e) {
			sentry.captureException(e)
		}

		// todo: Find a way to use the route with placeholders as the transaction
		// eg. /v1/:bucket/:key{.*} rather than /v1/mybucket/mykey
		// For now, just use 'fetch' as the transaction name
		const tx = sentry.startTransaction({ name: 'fetch' })
		sentry.configureScope((scope) => {
			scope.setSpan(tx)
		})
		c.set('tx', tx)

		await next()

		tx.finish()
	})
	.onError((err, c) => {
		c.get('sentry').captureException(err)
		return c.text('internal server error', 500)
	})

	// Auth all routes
	.use(async (c, next) => {
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
		c.get('sentry').setTags({ bucket: bucketName, key: c.req.param('key') })
		await next()
	})

	.get('/:bucket/:key{.*}', async (c) => {
		const key = c.req.param('key')

		const span = c
			.get('tx')
			.startChild({ op: 'bucket.get', description: 'get from storage' })
			.setData('key', key)

		try {
			const kvRes = await c.get('bucket').get(key)
			if (!kvRes) {
				span.setStatus('not_found')
				return c.notFound()
			}
			span.setStatus('ok').setData('bodyLength', kvRes.size)

			c.header(
				'Content-Type',
				kvRes.httpMetadata?.contentType || 'application/octet-stream'
			)
			c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
			const response = c.body(await kvRes.arrayBuffer())

			return response
		} catch (e) {
			span.setStatus('internal_error')
			throw e
		} finally {
			span.finish()
		}
	})

	.put(async (c) => {
		const key = c.req.param('key')
		const contentType = c.req.headers.get('Content-Type')
		if (!contentType) {
			return c.text('missing content-type header', 400)
		}

		const body = await c.req.arrayBuffer()
		c.get('sentry').configureScope((scope) => {
			scope.addAttachment({
				data: new TextDecoder().decode(body),
				contentType,
				filename: 'request-body.json',
			})
		})

		const span = c
			.get('tx')
			.startChild({ op: 'bucket.put', description: 'put to storage' })
			.setData('bodyLength', body.byteLength)
			.setData('contentType', contentType)
			.setData('key', key)

		try {
			await c.get('bucket').put(key, body, {
				httpMetadata: {
					contentType,
				},
			})
			return c.body(null, 200)
		} catch (e) {
			span.setStatus('internal_error')
			throw e
		} finally {
			span.finish()
		}
	})

	.delete(async (c) => {
		const key = c.req.param('key')
		const span = c
			.get('tx')
			.startChild({ op: 'bucket.delete', description: 'delete from storage' })
			.setData('key', key)

		try {
			await c.get('bucket').delete(key)
			return c.body(null, 200)
		} catch (e) {
			span.setStatus('internal_error')
			throw e
		} finally {
			span.finish()
		}
	})

app.route('/v1', kvApp)

export default app
