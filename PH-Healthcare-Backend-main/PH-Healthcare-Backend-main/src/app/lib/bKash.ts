import config from "../config";
import httpStatus from "http-status";
import { AppError } from "../utils/AppError";
import { redisClient } from "./redis";

export const getBkashIdToken = async () => {
  try {
    const IdTokenKey = "bKash: idToken";
    const RefreshTokenKey = "bKash: refreshToken";

    // bKash id token get from redis
    let bKashIdToken = await redisClient.get(IdTokenKey);
    // get bKash id token ttl from redis
    const bKashIdTokenTTL = await redisClient.ttl(IdTokenKey);

    // bKash refresh token get from redis
    const bKashRefreshToken = await redisClient.get(RefreshTokenKey);
    // get bKash refresh token ttl from redis
    const bKashRefreshTokenTTL = await redisClient.ttl(RefreshTokenKey);

    // console.log({
    //   bKashIdToken,
    //   bKashIdTokenTTL,
    //   bKashRefreshToken,
    //   bKashRefreshTokenTTL,
    // });

    // if bKash id token not exist / expired in redis and bKash refresh token must exist in redis, then regenerate bKash id token from bKash refresh token
    //bKash id token remaining time is less than or equal 10 minutes
    //bKash refresh token remaining time is more than 10 minutes
    if (
      (!bKashIdToken || bKashIdTokenTTL <= 600) &&
      bKashRefreshToken &&
      bKashRefreshTokenTTL > 600
    ) {
      const refreshTokenResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/token/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            username: config.bkash_username,
            password: config.bkash_password,
          },
          body: JSON.stringify({
            app_key: config.bkash_app_key,
            app_secret: config.bkash_app_secret,
            refresh_token: bKashRefreshToken,
          }),
        },
      );

      // if bKash refresh token response is not ok then throw error
      if (!refreshTokenResponse.ok) {
        throw new AppError(httpStatus.BAD_GATEWAY, "Failed to refresh bKash id token");
      }

      // refresh bKash id token
      const bKashRefreshTokenResult = await refreshTokenResponse.json();

      // bKash id token set from bKash refresh token
      bKashIdToken = bKashRefreshTokenResult.id_token as string;

      // bKash id token set in redis with 1 hour ttl
      await redisClient.set(IdTokenKey, bKashIdToken, {
        expiration: {
          type: "EX",
          value: 60 * 60, // 1 hour
        },
      });

      return bKashIdToken;
    }

    // if bKash id token TTL is greater than 10 minutes then return bKash id token
    if (bKashIdTokenTTL > 600) {
      return bKashIdToken;
    }

    const res = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/token/grant`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          username: config.bkash_username,
          password: config.bkash_password,
        },
        body: JSON.stringify({
          app_key: config.bkash_app_key,
          app_secret: config.bkash_app_secret,
        }),
      },
    );

    if (!res.ok) {
      throw new AppError(httpStatus.BAD_GATEWAY, "Failed to get bKash ID Token");
    }

    const result = await res.json();

    // bKash id token set
    await redisClient.set(IdTokenKey, result.id_token, {
      expiration: {
        type: "EX",
        value: 60 * 60, // 1 hour
      },
    });

    // bKash refresh token set
    await redisClient.set(RefreshTokenKey, result.refresh_token, {
      expiration: {
        type: "EX",
        value: 60 * 60 * 24 * 28, // 28 days
      },
    });

    bKashIdToken = result.id_token;

    return bKashIdToken;
  } catch (error: any) {
    console.error("bKash token error:", error, error.cause);
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      error.cause?.message || error.message,
    );
  }
};
