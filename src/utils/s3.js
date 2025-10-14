const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const config = require("../../config");

const requiredConfig = {
  S3_BUCKET_NAME: config.S3_BUCKET_NAME,
  S3_REGION: config.S3_REGION,
  S3_ACCESS_KEY_ID: config.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: config.S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT: config.S3_ENDPOINT,
};

const missing = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  throw new Error(
    `Missing required S3 configuration values: ${missing.join(", ")}`
  );
}

const bucketName = config.S3_BUCKET_NAME;

const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
});

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const listObjects = async (prefix = "") => {
  const results = [];
  let continuationToken;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    const response = await s3.send(command);
    if (response.Contents) {
      results.push(...response.Contents);
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return results;
};

const getObject = async key => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const response = await s3.send(command);
  return {
    metadata: {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      etag: response.ETag,
      lastModified: response.LastModified,
      userMetadata: response.Metadata || {},
    },
    body: await streamToBuffer(response.Body),
  };
};

const putObject = async (key, body, contentType = "application/octet-stream", metadata = {}) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  });

  await s3.send(command);
};

const deleteObject = async key => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3.send(command);
};

const checkConnectivity = async () => {
  try {
    const command = new HeadBucketCommand({
      Bucket: bucketName,
    });
    await Promise.race([
      s3.send(command),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("S3 connectivity check timed out after 10 seconds")), 10000)
      ),
    ]);
    return true;
  } catch (error) {
    console.warn(`S3 connectivity check failed: ${error.message}`);
    return false;
  }
};

module.exports = {
  listObjects,
  getObject,
  putObject,
  deleteObject,
  checkConnectivity,
};
