require("dotenv").config();
const express = require("express");
const { BigQuery } = require("@google-cloud/bigquery");
const cors = require("cors");

const app = express();
const bigquery = new BigQuery();

app.use(cors());
app.use(express.json());

app.get("/release-notes", async (req, res) => {
  try {
    const lastPublishedAt = req.query.last_published_at;

    if (!lastPublishedAt) {
      return res
        .status(400)
        .json({ error: "Missing 'last_published_at' parameter" });
    }

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
    console.log(`Query results: ${rows.length} rows`);

    res.json({ release_notes: rows });
  } catch (error) {
    console.error("Error fetching release notes:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
