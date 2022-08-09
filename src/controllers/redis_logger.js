const Redis = require("ioredis");

class RedisLogger {
  constructor(prefix) {
    this.prefix = prefix;
    this.clientEnabled = process.env.REDIS_HOST !== undefined && process.env.REDIS_PORT !== undefined;

    if (!this.clientEnabled) {
      return;
    }

    if (process.env.REDIS_CLUSTER === 'true') {
      const details = { redisOptions: {} };

      if (process.env.REDIS_PASSWORD) {
        details.redisOptions.password = process.env.REDIS_PASSWORD;
      }
      if (process.env.REDIS_TLS_ENABLED) {
        details.redisOptions.tls = { checkServerIdentity: () => undefined };
      }

      this.client = new Redis.Cluster([
        {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
      ], details);
    } else {
      const details = {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
      };
      if (process.env.REDIS_PASSWORD) {
        details.password = process.env.REDIS_PASSWORD;
      }
      if (process.env.REDIS_TLS_ENABLED) {
        details.tls = { checkServerIdentity: () => undefined };
      }
      this.client = new Redis(details);
    }

    //operation so that KEY_1 can be updated with max length of KEY_2 (array), after ARGV_1 is added to the array
    this.client.defineCommand("updateConcurrentSet", {
      numberOfKeys: 2,
      lua: `
      redis.call('SADD', KEYS[2], ARGV[1])
      local len = #(redis.call('SMEMBERS', KEYS[2]) or {})
      local val = redis.call('GET', KEYS[1]) or 0
      if tonumber(val) < len then redis.call('SET', KEYS[1], len)
      end
      `,
    });
    
  }

  async logUserFailiure() {
    if (this.clientEnabled) await this.client.incr(this.prefix+"user_failiures")
  }

  async getUserFailiures() {
    if (this.clientEnabled) return await this.client.get(this.prefix+"user_failiures")
  }
  
  async logServerFailiure() {
    if (this.clientEnabled) await this.client.incr(this.prefix+"server_failiures")
  }

  async getServerFailiures() {
    if (this.clientEnabled) return await this.client.get(this.prefix+"server_failiures")
  }

  async logSuccess() {
    if (this.clientEnabled) await this.client.incr(this.prefix+"successes")
  }

  async getSuccesses() {
    if (this.clientEnabled) return await this.client.get(this.prefix+"successes")
  }

  async startSyncRequest(requestNum) {
    if (this.clientEnabled) {
      await Promise.all([
        this.client.updateConcurrentSet(this.prefix+"high_requests_sync", this.prefix+"requests_sync", requestNum),
        this.client.zadd(this.prefix+"all_requests_sync", Date.now(), requestNum)
      ]);
    }
  }

  async endSyncRequest(requestNum) {
    if (this.clientEnabled) {
      await this.client.srem(this.prefix+"requests_sync", requestNum)
    }
  }

  async startAsyncRequest(requestId) {
    if (this.clientEnabled) {
      await Promise.all([
        this.client.updateConcurrentSet(this.prefix+"high_requests_async", this.prefix+"requests_async", requestId),
        this.client.zadd(this.prefix+"all_requests_async", Date.now(), requestId)
      ]);
    }
  }

  async endAsyncRequest(requestId) {
    if (this.clientEnabled) {
      await this.client.srem(this.prefix+"requests_async", requestId)
    }
  }

  async clearAsyncRequests() {
    if (this.clientEnabled) {
      await this.client.del(this.prefix+"requests_async")
    }
  }

  async getSyncConcurrentHighMark() {
    return await this.client.get(this.prefix+"high_requests_sync")
  }

  async getAsyncConcurrentHighMark() {
    return await this.client.get(this.prefix+"high_requests_async")
  }

  async getSyncRequestsInLast(hours) {
    const ms = hours * 60 * 60 * 1000;
    const [minMs, maxMs] = [Date.now() - ms, Date.now()];
    return (await this.client.zrangebyscore(this.prefix+"all_requests_sync", minMs, maxMs))?.length
  }

  async getAsyncRequestsInLast(hours) {
    const ms = hours * 60 * 60 * 1000;
    const [minMs, maxMs] = [Date.now() - ms, Date.now()];
    return (await this.client.zrangebyscore(this.prefix+"all_requests_async", minMs, maxMs))?.length
  }

  async getLogs() {
    if (this.clientEnabled) {
      const [
        user_failiures, 
        server_failiures, 
        successes, 
        sync_concurrent_high_mark, 
        async_concurrent_high_mark,
        sync_avg_hour,
        async_avg_hour,
        sync_avg_day,
        async_avg_day
      ] = await Promise.all([
        this.getUserFailiures(),
        this.getServerFailiures(),
        this.getSuccesses(),
        this.getSyncConcurrentHighMark(),
        this.getAsyncConcurrentHighMark(),
        this.getSyncRequestsInLast(1),
        this.getAsyncRequestsInLast(1),
        this.getSyncRequestsInLast(24),
        this.getSyncRequestsInLast(24)
      ])

      return {
        user_failiures,
        server_failiures,
        successes,
        sync_concurrent_high_mark,
        async_concurrent_high_mark,
        sync_avg_hour,
        async_avg_hour,
        sync_avg_day,
        async_avg_day
      }
    }
    return {};
  }
}

module.exports = new RedisLogger("bte:logging:")