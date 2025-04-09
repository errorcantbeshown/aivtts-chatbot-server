import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// Helper to stream S3 data to string
const streamToString = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
};

// Initialize S3 client
const s3 = new S3Client({
    region: 'us-east-2', // Change if needed
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = 'aivoicetts';

// Upload JSON to S3 with SSE-S3
export async function uploadJson(jsonFileName, data) {
    const params = {
        Bucket: BUCKET_NAME,
        Key: jsonFileName,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256'
    };

    await s3.send(new PutObjectCommand(params));
    console.log('Uploaded JSON to S3');
}

// Download JSON from S3
export async function downloadJson(jsonFileName) {
    const params = {
        Bucket: BUCKET_NAME,
        Key: jsonFileName
    };

    try {
        const result = await s3.send(new GetObjectCommand(params));
        const body = await streamToString(result.Body);
        const jsonData = JSON.parse(body);
        console.log('Downloaded JSON:', jsonData);
        return jsonData;
    } catch (error) {
        if ( error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404 ) {
            console.log(`File not found: ${jsonFileName}. Creating a new one...`);

            const defaultData = {
                users: []
            };

            await uploadJson(jsonFileName, defaultData);
            return defaultData;
        } else {
            throw error; // Re-throw other errors
        }
    }
}
