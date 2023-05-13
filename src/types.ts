import { Toucan } from 'toucan-js'

export type Bindings = {
	EMAIL: KVNamespace
	SENTRY_DSN: string
	/** API key for authing to kv-proxy */
	API_KEY: string
}

export type Variables = {
	sentry: Toucan
}

export type AppContext = {
	Bindings: Bindings
	Variables: Variables
}
