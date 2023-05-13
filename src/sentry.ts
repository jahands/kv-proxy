import { Toucan } from 'toucan-js'
import { AppContext, Bindings } from './types'
import { Context } from 'hono'

declare const ENVIRONMENT: string

export function initSentry(
	request: Request,
	env: Bindings,
	ctx: ExecutionContext
): Toucan {
  
	return new Toucan({
		dsn: env.SENTRY_DSN,
		context: ctx,
		environment: ENVIRONMENT,
		release: env.SENTRY_RELEASE,
		request,
		requestDataOptions: {
			allowedSearchParams: /^(?!(key)$).+$/,
		},
	})
}

export function getSentry(c: Context<AppContext>): Toucan {
	return c.get('sentry')
}
