import { Toucan } from 'toucan-js'

export type R2Buckets = 'eemailme'

export type Bindings = {
	EEMAILMEKV: R2Bucket
	// Had to specify port because this bypasses
	// the Sentry worker for some reason
	SENTRY_DSN: string
	SENTRY_RELEASE: string
	/** API key for authing to kv-proxy */
	API_KEY: string
}

export type Variables = {
	sentry: Toucan
}

export type App = {
	Bindings: Bindings
	Variables: Variables
}
