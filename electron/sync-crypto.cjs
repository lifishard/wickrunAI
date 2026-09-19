'use strict';
/**
 * 同步包的信封。
 *
 * 同步包要经过一个中转落点：网盘目录、Syncthing 的共享文件夹、tailnet 上的
 * 一个共享目录、甚至一个 U 盘。这些地方全都不可信 —— 不是说它们一定被人
 * 看，是说这套东西不该建立在「它们不会被看」这个假设上。所以包出门前先封，
 * 落点上躺的永远是密文。
 *
 * 口令派生用 scrypt。参数按 N=2^15 取，在普通笔记本上一次大约几十到一百
 * 毫秒 —— 同步是低频动作，用户等得起，而这个代价会原样加到爆破的每一次
 * 尝试上。每个包一份新 salt、一份新 nonce，绝不复用。
 *
 * 认证用 AES-256-GCM 自带的 tag，并且把版本、salt、nonce 一起当 AAD 绑进去。
 * 不绑的话，改包头（比如把版本号改小，诱导旧解析路径）不会破坏 tag，
 * 那等于留了一条降级攻击的路。
 *
 * 这里没有「万一忘了口令怎么办」的后门，也不打算有。有后门的话，后门就是
 * 整套东西的实际安全等级。忘了口令就重新配一次同步，代价是重新合并一次。
 */
const crypto = require('node:crypto');

const FORMAT = 'wickrunAI-sync';
const VERSION = 1;
const SCRYPT = Object.freeze({ N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 96 * 1024 * 1024 });
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
/** 口令太短的话上面那些参数也救不回来，所以在入口就拦掉。 */
const MIN_PASSPHRASE = 12;
/** 单个同步包的上限，防止一个畸形包把内存吃光。 */
const MAX_SEALED_BYTES = 64 * 1024 * 1024;

function derive(passphrase, salt) {
  return crypto.scryptSync(Buffer.from(String(passphrase), 'utf8'), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
}

function aad(header) {
  return Buffer.from(
    JSON.stringify({ format: header.format, version: header.version, salt: header.salt, nonce: header.nonce }),
    'utf8',
  );
}

function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`同步口令至少 ${MIN_PASSPHRASE} 位。这串口令是同步包的唯一一道锁。`);
  }
}

/** 封一个同步包。payload 是任意可 JSON 化的东西。 */
function seal(payload, passphrase) {
  checkPassphrase(passphrase);
  const salt = crypto.randomBytes(SALT_BYTES);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const header = {
    format: FORMAT,
    version: VERSION,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    // scrypt 参数写进包里：以后调参了，旧包还能按它自己的参数解开。
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keyLen: SCRYPT.keyLen },
    createdAt: new Date().toISOString(),
  };
  const key = derive(passphrase, salt);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(header));
    const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
    return JSON.stringify({
      ...header,
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    });
  } finally {
    key.fill(0);
  }
}

/** 拆一个同步包。口令不对、包被改过、格式不认识，一律抛错，绝不返回半份数据。 */
function open(sealed, passphrase) {
  checkPassphrase(passphrase);
  if (typeof sealed !== 'string' || Buffer.byteLength(sealed) > MAX_SEALED_BYTES) {
    throw new Error('同步包为空或超过大小上限');
  }
  let env;
  try {
    env = JSON.parse(sealed);
  } catch {
    throw new Error('同步包不是有效的 JSON');
  }
  if (!env || env.format !== FORMAT) throw new Error('这不是 wickrunAI 的同步包');
  if (env.version !== VERSION) throw new Error(`同步包版本 ${env.version} 不被这个版本支持`);
  const kdf = env.kdf || {};
  if (kdf.name !== 'scrypt') throw new Error('同步包用了不认识的口令派生方式');
  // 参数从包里读，但要设上限：包是别人给的，N 写成 2^30 就是一发内存炸弹。
  if (!(kdf.N > 0 && kdf.N <= SCRYPT.N && kdf.r > 0 && kdf.r <= 16 && kdf.p > 0 && kdf.p <= 4 && kdf.keyLen === 32)) {
    throw new Error('同步包的口令派生参数超出允许范围');
  }
  const salt = Buffer.from(String(env.salt || ''), 'base64');
  const nonce = Buffer.from(String(env.nonce || ''), 'base64');
  const tag = Buffer.from(String(env.tag || ''), 'base64');
  const body = Buffer.from(String(env.body || ''), 'base64');
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new Error('同步包的头部长度不对');
  }
  const key = crypto.scryptSync(Buffer.from(String(passphrase), 'utf8'), salt, kdf.keyLen, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT.maxmem,
  });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(env));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (e) {
    // 口令错和包被改过给同一句话：区分开来等于告诉试口令的人「口令对了但包坏了」。
    throw new Error('同步包打不开：口令不对，或者这个包被改动过。');
  } finally {
    key.fill(0);
  }
}

module.exports = { seal, open, FORMAT, VERSION, MIN_PASSPHRASE, MAX_SEALED_BYTES, SCRYPT };
