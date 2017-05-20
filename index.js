const amqp = require('amqplib')
const redis = require('redis')

const env = require('./lib/env')
const {parseRegistryUrl, checkFollower, startChanges} = require('./lib/follow')

;(async () => {
  const conn = await amqp.connect(env.AMQP_URL)
  const channel = await conn.createChannel()
  await channel.assertQueue(env.QUEUE_NAME, {
    maxPriority: 5
  })
  const client = redis.createClient(env.REDIS_URL)

  env.REGISTRY_URLS.forEach(registryUrl => {
    const registry = parseRegistryUrl(registryUrl)
    const start = startChanges.bind(null, {
      channel,
      client,
      registry
    }, (err, changes) => {
      if (err) return start()
      const check = checkFollower.bind(null, {
        registry,
        changes,
        client
      }, restart => {
        if (restart) return start()
        setTimeout(check, 30000)
      })
      setTimeout(check, 30000)
    })
    start()
  })
})()
