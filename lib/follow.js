const crypto = require('crypto')
const url = require('url')

const _ = require('lodash')
const ChangesStream = require('changes-stream')
const request = require('request')
const StatsD = require('hot-shots')
const cleanDoc = require('normalize-registry-metadata')

const env = require('./env')
const rollbar = require('./rollbar')
const { asyncTimeout } = require('./util')

const statsdClient = new StatsD({
  host: env.STATSD_HOST,
  prefix: 'changes.',
  globalTags: [env.NODE_ENV]
})

function hash (host) {
  return crypto.createHash('sha1')
    .update(host)
    .digest('hex')
    .slice(0, 8)
}

function parseRegistryUrl (registry) {
  const registryUrlParsed = url.parse(registry, true)
  const registryUrlQuery = registryUrlParsed.query
  registryUrlParsed.pathname = registryUrlParsed.pathname.replace('/_changes', '')
  delete registryUrlParsed.query
  delete registryUrlParsed.search
  const registryUrl = registryUrlParsed.format()
  return {
    rawUrl: registry,
    url: registryUrl,
    query: registryUrlQuery,
    seqKey: `${env.REDIS_SEQ_KEY}-${hash(registryUrlParsed.host)}`
  }
}

function checkFollower ({ registry, client, changes }, done) {
  request({
    url: registry.url,
    json: true
  }, (err, resp, data) => {
    if (err || resp.statusCode !== 200) return done()
    client.get(registry.seqKey, (err, reply) => {
      const seq = parseInt(reply, 10)
      if (err || isNaN(seq) || data.update_seq >= seq) return done()
      changes.destroy()
      client.set(registry.seqKey, Math.max(0, data.update_seq - 3000), err => {
        if (err) rollbar.error(err, data)
        done(true)
      })
    })
  })
}

async function handleChange ({ channel, client, registry }, change) {
  statsdClient.increment('change')
  statsdClient.gauge('sequence', change.seq)
  client.set(registry.seqKey, change.seq, err => {
    if (err) rollbar.error(err)
  })

  cleanDoc(change.doc)
  const distTags = _.get(change, 'doc.dist-tags')
  const versions = _.mapValues(change.doc.versions, v => _.pick(v, ['gitHead', 'repository', 'license', '_npmUser']))

  const payload = {
    name: 'registry-change',
    dependency: change.id,
    distTags,
    versions,
    registry: registry.rawUrl
  }

  try {
    await asyncTimeout(env.REGISTRY_CHANGE_DELAY, async () => {
      const payloadBuffer = Buffer.from(JSON.stringify(payload))
      await channel.sendToQueue(env.QUEUE_NAME, payloadBuffer, { priority: 1 })
    })
  } catch (err) {
    rollbar.error(err)
  }
}

function startChanges ({ channel, client, registry }, cb) {
  client.get(registry.seqKey, function (err, reply) {
    if (err) rollbar.error(err)

    const startSeq = parseInt(reply, 10)
    const since = isNaN(startSeq) ? 'now' : startSeq

    console.log('starting changes stream', registry.url, `(${registry.seqKey}: ${since})`)

    const changes = new ChangesStream({
      db: registry.url,
      since,
      include_docs: true,
      query_params: registry.query
    })
    changes.on('error', function (error) {
      rollbar.error(error)
      changes.destroy()
      cb(error || new Error('resarting'))
    })
    changes.on('data', handleChange.bind(null, { channel, client, registry }))
    cb(null, changes)
  })
}

module.exports = {
  statsdClient,
  hash,
  parseRegistryUrl,
  checkFollower,
  handleChange,
  startChanges
}
