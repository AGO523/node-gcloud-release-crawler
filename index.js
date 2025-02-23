require("dotenv").config();
const express = require("express");
const { BigQuery } = require("@google-cloud/bigquery");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

const app = express();
const bigquery = new BigQuery();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const MAX_ATTEMPTS = 3;

app.use(cors());
app.use(express.json());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数バックオフを使用して待機する
 * @param {number} attempt - 試行回数
 */
const exponentialBackoff = (attempt) => {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.pow(5, attempt) * 1000)
  );
};

/**
 * Gemini API を使用してリリースノートを翻訳＆要約
 * @param {string} description - 英語のリリースノートの説明
 * @returns {Promise<string>} - 日本語の翻訳＋要約
 */
async function translateAndSummarize(description) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (!description) return "翻訳エラー: 無効な入力";

      const prompt = `次のGoogle Cloudリリースノートの内容を日本語で翻訳し、簡潔に要約してください:\n\n"${description}"`;

      sleep(5000);
      const result = await model.generateContent(prompt);
      return result.response.text() || "翻訳エラー: 応答がありません";
    } catch (error) {
      console.error(`Gemini API Error (Attempt ${attempt}):`, error);

      if (
        [429, 500, 502, 503, 504].includes(error.status) &&
        attempt < MAX_ATTEMPTS
      ) {
        console.log(`Retrying Gemini API... (Attempt ${attempt})`);
        await exponentialBackoff(attempt);
      } else {
        return "翻訳エラー: Gemini APIの呼び出しに失敗しました";
      }
    }
  }

  return "翻訳エラー: 最大リトライ回数に達しました";
}

/**
 * Slack にリリースノートを送信する
 * @param {string} date - リリース日
 * @param {Array} releaseNotes - 通知するリリースノートのリスト
 */
async function sendToSlack(date, releaseNotes) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL_ID) {
        console.error(
          "SLACK_TOKEN または SLACK_CHANNEL_ID が設定されていません"
        );
        return;
      }

      const releaseNotesLink = `https://cloud.google.com/release-notes#${date.replace(
        /-/g,
        "_"
      )}`;

      const formattedNotes = releaseNotes
        .map((note) => {
          return `*product_name:* ${note.product_name}\n*release_note_type:* ${note.release_note_type}\n*description:*\n${note.translated_description}`;
        })
        .join("\n\n");

      const payload = {
        channel: process.env.SLACK_CHANNEL_ID,
        text: `📢 *${date} のリリースノート*\n<${releaseNotesLink}|[リリースノート詳細]>\n\n${formattedNotes}`,
      };

      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });

      const jsonResponse = await response.json();
      if (!jsonResponse.ok) {
        throw new Error(`Slack API エラー: ${jsonResponse.error}`);
      }

      console.log("Slack への通知が完了しました");
      return;
    } catch (error) {
      console.error(`Slack API Error (Attempt ${attempt}):`, error);

      if (
        [429, 500, 502, 503, 504].includes(error.status) &&
        attempt < MAX_ATTEMPTS
      ) {
        console.log(`Retrying Slack API... (Attempt ${attempt})`);
        await exponentialBackoff(attempt);
      } else {
        console.error("Slack API 送信エラー: 最大リトライ回数に達しました");
        return;
      }
    }
  }
}

/**
 * リリースノートを取得＆Slackに通知
 */
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

    const translatedNotes = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        translated_description: await translateAndSummarize(row.description),
      }))
    );

    await sendToSlack(lastPublishedAt, translatedNotes);

    res.json({ release_notes: translatedNotes });
  } catch (error) {
    console.error("Error fetching release notes:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
