const {EventEmitter} = require('events')

const amqp = require('amqplib')
const nock = require('nock')
const redis = require('redis-mock')
const {test, afterEach, tearDown} = require('tap')
const proxyquire = require('proxyquire')

const env = require('../lib/env')

class ChangesStream extends EventEmitter {
  constructor (opts) {
    super()
    this._opts = opts
    this.destroyed = false
  }
  destroy () {
    this.destroyed = true
  }
}

const {
  statsdClient,
  hash,
  parseRegistryUrl,
  checkFollower,
  handleChange,
  startChanges
} = proxyquire('../lib/follow', {
  'changes-stream': ChangesStream
})

;(async () => {
  const conn = await amqp.connect(env.AMQP_URL)
  const channel = await conn.createChannel()
  await channel.assertQueue(env.QUEUE_NAME, {
    maxPriority: 5
  })

  afterEach(() => channel.purgeQueue().then(() => {}))

  tearDown(() => {
    conn.close()
    statsdClient.close()
  })

  test('get correct hash', t => {
    t.is(hash('greenkeeper.io'), '12feacc1', 'hash')
    t.end()
  })

  test('parse registry', t => {
    const url = 'https://skimdb.npmjs.com/registry/_changes?token=1234'
    const parsed = parseRegistryUrl(url)
    t.is(parsed.rawUrl, url, 'rawUrl')
    t.is(parsed.url, 'https://skimdb.npmjs.com/registry', 'url')
    t.same(parsed.query, { token: '1234' }, 'query')
    t.is(parsed.seqKey, `changes-seq-${hash('skimdb.npmjs.com')}`, 'seqKey')
    t.end()
  })

  test('check follower invalid http response', t => {
    t.plan(1)
    nock('https://skimdb.npmjs.com')
    .get('/registry')
    .reply(500, {})

    checkFollower({
      registry: {
        url: 'https://skimdb.npmjs.com/registry'
      }
    }, restart => {
      t.notOk(restart, 'restart')
    })
  })

  test('check follower valid seq', t => {
    t.plan(4)
    nock('https://skimdb.npmjs.com')
    .get('/registry')
    .reply(200, {update_seq: 5000})

    const client = redis.createClient()
    client.set('gk-seq', 4000, err => {
      t.error(err, 'error')
      checkFollower({
        registry: {
          url: 'https://skimdb.npmjs.com/registry',
          seqKey: 'gk-seq'
        },
        client,
        changes: {
          destroy: () => t.ok(true, 'destroy called')
        }
      }, restart => {
        t.notOk(restart, 'restart')
        client.get('gk-seq', (err, res) => {
          t.error(err, 'error')
          t.is(res, '4000', 'seq')
        })
      })
    })
  })

  test('check follower invalid seq', t => {
    t.plan(5)
    nock('https://skimdb.npmjs.com')
    .get('/registry')
    .reply(200, {update_seq: 5000})

    const client = redis.createClient()
    client.set('gk-seq', 6000, err => {
      t.error(err, 'error')
      checkFollower({
        registry: {
          url: 'https://skimdb.npmjs.com/registry',
          seqKey: 'gk-seq'
        },
        client,
        changes: {
          destroy: () => t.ok(true, 'destroy called')
        }
      }, restart => {
        t.ok(restart, 'restart')
        client.get('gk-seq', (err, res) => {
          t.error(err, 'error')
          t.is(res, '2000', 'seq')
        })
      })
    })
  })

  test('handle change event', async function (t) {
    t.plan(3)
    const client = redis.createClient()
    const rawUrl = 'https://skimdb.npmjs.com/registry'
    handleChange({
      channel,
      client,
      registry: {
        seqKey: 'gk-seq',
        rawUrl
      }
    }, {
      id: 'package',
      seq: 1000,
      doc: {
        _id: 'package',
        'dist-tags': {
          latest: '1.0.0',
          next: '2.0.0rc1'
        },
        versions: {
          '1.0.0': {
            name: 'package',
            gitHead: 'a213fe9c'
          },
          '2.0.0rc1': {
            name: 'package-rc'
          }
        }
      }
    })
    const job = await channel.get(env.QUEUE_NAME)
    t.same(JSON.parse(job.content.toString()), {
      name: 'registry-change',
      dependency: 'package',
      distTags: {
        latest: '1.0.0',
        next: '2.0.0-rc1'
      },
      versions: {
        '1.0.0': {gitHead: 'a213fe9c'},
        '2.0.0-rc1': {}
      },
      registry: rawUrl
    }, 'job data')
    client.get('gk-seq', (err, res) => {
      t.error(err, 'error')
      t.is(res, '1000', 'seq')
    })
  })

  test('start changes', t => {
    t.plan(2)
    const client = redis.createClient()
    const url = 'https://skimdb.npmjs.com/registry'
    let savedChanges
    startChanges({
      channel,
      client,
      registry: {
        url,
        seqKey: 'gk-seq-2',
        query: {token: '1234'}
      }
    }, (err, changes) => {
      if (err) return t.ok(savedChanges.destroyed, 'destroyed')
      savedChanges = changes
      t.same(changes._opts, {
        db: url,
        since: 'now',
        include_docs: true,
        query_params: {token: '1234'}
      }, 'opts')
      changes.emit('error', new Error('restart'))
    })
  })
})()
