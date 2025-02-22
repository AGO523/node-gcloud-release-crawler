require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");

const bigquery = new BigQuery();

async function fetchReleaseNotes() {
  try {
    // `last_published_at` を環境変数から取得（Cloud Scheduler から渡せる）
    const lastPublishedAt = process.env.LAST_PUBLISHED_AT || "2025-02-01";

    console.log(`Fetching release notes since ${lastPublishedAt}`);

    const query = `
      SELECT product_name, description, release_note_type, published_at
      FROM \`bigquery-public-data.google_cloud_release_notes.release_notes\`
      WHERE DATE(published_at) > @lastPublishedAt
      ORDER BY published_at DESC
    `;

    const options = {
      query,
      params: { lastPublishedAt },
      location: "US",
    };

    const [rows, job] = await bigquery.query(options);
    console.log(`Query processed: ${job.totalBytesProcessed} bytes`);

    console.log("Release Notes:", JSON.stringify(rows, null, 2));

    console.log("Job completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error fetching release notes:", error);
    process.exit(1);
  }
}

fetchReleaseNotes();
