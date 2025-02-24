require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

const bigquery = new BigQuery();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const MAX_ATTEMPTS = 3;

/**
 * 指数バックオフを使用して待機する
 */
const exponentialBackoff = (attempt) => {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.pow(5, attempt) * 1000)
  );
};

/**
 * 日本時間（JST）で1日前の日付を取得（YYYY-MM-DD）
 */
const getPreviousJSTDate = () => {
  const jstNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  jstNow.setDate(jstNow.getDate() - 4); // 4日前の日付を取得

  return jstNow.toISOString().split("T")[0];
};

/**
 * Gemini API を使用してリリースノートを翻訳＆要約
 */
async function translateAndSummarize(description) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (!description) return "翻訳エラー: 無効な入力";

      const prompt = `次のGoogle Cloudリリースノートの内容を日本語で翻訳し、簡潔に要約してください:\n\n"${description}"`;

      await exponentialBackoff(1);
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
 */
async function sendToSlack(date, releaseNotes) {
  try {
    if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL_ID) {
      console.error("SLACK_TOKEN または SLACK_CHANNEL_ID が設定されていません");
      return;
    }

    const releaseNotesLink = `https://cloud.google.com/release-notes#${date.replace(
      /-/g,
      "_"
    )}`;

    let message;

    if (releaseNotes.length === 0) {
      message = `📢 *${date} のリリースノート*\n本日の更新はありません。`;
    } else {
      const formattedNotes = releaseNotes
        .map((note) => {
          return `*product_name:* ${note.product_name}\n*release_note_type:* ${note.release_note_type}\n*description:*\n${note.translated_description}`;
        })
        .join("\n\n");

      message = `📢 *${date} のリリースノート*\n<${releaseNotesLink}|[リリースノート詳細]>\n\n${formattedNotes}`;
    }

    const payload = {
      channel: process.env.SLACK_CHANNEL_ID,
      text: message,
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
  } catch (error) {
    console.error("Slack API 送信エラー:", error);
  }
}

/**
 * Cloud Run Job 実行時にリリースノートを取得・翻訳・Slack 送信
 */
async function fetchReleaseNotes() {
  try {
    const lastPublishedAt = getPreviousJSTDate();
    console.log(`Fetching release notes since ${lastPublishedAt}`);

    const query = `
      SELECT product_name, description, release_note_type, published_at
      FROM \`bigquery-public-data.google_cloud_release_notes.release_notes\`
      WHERE DATE(published_at) = @lastPublishedAt
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

    console.log("Cloud Run Job completed successfully.");
  } catch (error) {
    console.error("Error fetching release notes:", error);
  }
}

// Cloud Run Job 実行時にこの関数を呼び出す
fetchReleaseNotes();
