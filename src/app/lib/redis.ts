import { createClient } from "redis";
import config from "../config";

// Redis is used for:
// - storing email OTPs during registration / password reset
// - caching bKash API tokens
// - caching roommate match results & public search payloads
export const redisClient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	socket: {
		host: config.redis_host,
		port: parseInt(config.redis_port),
	},
});
