import { Hono } from 'hono'
import type { AppContext } from './types'
import { getSentry, initSentry } from './sentry'

const app = new Hono<AppContext>()

// Sentry
app.use(async (c, next) => {
  c.set('sentry', initSentry(c.req.raw, c.env, c.executionCtx))
	await next()
	if (c.error) {
		c.get('sentry').captureException(c.error)
  }
})

// Auth all routes
app.use(async (c, next) => {
  const { key } = c.req.query()
	if (key !== c.env.API_KEY) {
		return c.text('unauthorized', 401)
	}
	await next()
})

app.get('/', (c) => {
	return fetch('https://sentry.uuid.rocks/_health')
	return c.text('hello world!')
})

export default app

