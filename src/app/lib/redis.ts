import { createClient } from "redis";
import config from "../config";

// Redis is used for:
// - storing email OTPs during registration / password reset
// - caching bKash API tokens
// - caching roommate match results & public search payloads
//
// `disableOfflineQueue` makes commands issued while disconnected REJECT
// immediately instead of queueing forever — every fail-soft call site
// (try/catch) then actually fails fast during a Redis outage instead of
// hanging the request. `connectTimeout` + a bounded `reconnectStrategy`
// keep the background reconnect sane.
export const redisClient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	disableOfflineQueue: true,
	socket: {
		host: config.redis_host,
		port: parseInt(config.redis_port),
		connectTimeout: 10_000,
		reconnectStrategy: (retries) => Math.min(retries * 200, 2_000),
	},
});
