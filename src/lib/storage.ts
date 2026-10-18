import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import { logger } from '@/lib/logger'
import { uploadDir } from '@/lib/paths'

export interface StorageProvider {
  upload(key: string, data: Buffer, mimeType: string): Promise<{ url: string; size: number }>
  download(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  getUrl(key: string): string
  exists(key: string): Promise<boolean>
}

class LocalStorageProvider implements StorageProvider {
  private dir: string
  constructor(dir?: string) {
    this.dir = dir || uploadDir()
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }
  async upload(key: string, data: Buffer, _mimeType: string) {
    const path = join(this.dir, key)
    writeFileSync(path, data)
    return { url: `/api/files/${key.split('.')[0]}`, size: data.length }
  }
  async download(key: string) {
    const prefix = key.split('.')[0]
    const match = readdirSync(this.dir).find((f: string) => f.startsWith(prefix))
    if (!match) throw new Error('File not found')
    return readFileSync(join(this.dir, match))
  }
  async delete(key: string) {
    try {
      unlinkSync(join(this.dir, key))
    } catch {
      /* ignore */
    }
  }
  getUrl(key: string) {
    return `/api/files/${key.split('.')[0]}`
  }
  async exists(key: string) {
    return existsSync(join(this.dir, key))
  }
}

class S3StorageProvider implements StorageProvider {
  private config: { endpoint: string; bucket: string; accessKey: string; secretKey: string; region: string }
  constructor(config: S3StorageProvider['config']) {
    this.config = config
  }
  async upload(key: string, data: Buffer, mimeType: string) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      endpoint: this.config.endpoint || undefined,
      region: this.config.region,
      credentials: { accessKeyId: this.config.accessKey, secretAccessKey: this.config.secretKey },
      forcePathStyle: !!this.config.endpoint,
    })
    await client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data, ContentType: mimeType }))
    const url = this.config.endpoint
      ? `${this.config.endpoint}/${this.config.bucket}/${key}`
      : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
    return { url, size: data.length }
  }
  async download(key: string) {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: this.config.region,
      credentials: { accessKeyId: this.config.accessKey, secretAccessKey: this.config.secretKey },
    })
    const res = await client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }
  async delete(key: string) {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: this.config.region,
      credentials: { accessKeyId: this.config.accessKey, secretAccessKey: this.config.secretKey },
    })
    await client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
  }
  getUrl(key: string) {
    return this.config.endpoint
      ? `${this.config.endpoint}/${this.config.bucket}/${key}`
      : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
  }
  async exists(key: string) {
    try {
      await this.download(key)
      return true
    } catch {
      return false
    }
  }
}

let _provider: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (_provider) return _provider
  const provider = process.env.STORAGE_PROVIDER || 'local'
  if (provider === 's3' && process.env.S3_BUCKET) {
    _provider = new S3StorageProvider({
      endpoint: process.env.S3_ENDPOINT || '',
      bucket: process.env.S3_BUCKET,
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      region: process.env.S3_REGION || 'us-east-1',
    })
    logger.info('storage provider: s3', { bucket: process.env.S3_BUCKET })
  } else {
    _provider = new LocalStorageProvider()
    logger.info('storage provider: local')
  }
  return _provider
}

export function isStorageS3(): boolean {
  return process.env.STORAGE_PROVIDER === 's3' && !!process.env.S3_BUCKET
}
