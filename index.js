const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const port = process.env.PORT || 8080;

app.get("/crawl", async (req, res) => {
  try {
    // last_released_at の固定値を設定
    const lastReleasedAt = "February 13, 2025";

    // Puppeteer の起動（Cloud Run 用設定）
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new", // Cloud Run 環境での安定動作のため
    });
    const page = await browser.newPage();
    await page.goto("https://cloud.google.com/release-notes");

    // クロール処理
    const releaseNotes = await page.evaluate((lastReleasedAt) => {
      const notes = Array.from(document.querySelectorAll(".release-note"));

      return notes
        .map((note) => {
          const releaseAt =
            note
              .closest(".devsite-article")
              ?.querySelector(
                '.devsite-heading[role="heading"][aria-level="2"]'
              )
              ?.textContent?.trim() || "Unknown Date";

          // リリース日を Date オブジェクトに変換
          const releaseTimestamp = Date.parse(releaseAt);

          // last_released_at 以前のデータは無視
          if (
            isNaN(releaseTimestamp) ||
            releaseTimestamp <= Date.parse(lastReleasedAt)
          ) {
            return null;
          }

          const resourceName =
            note
              .querySelector(".release-note-product-title")
              ?.textContent?.trim() || "Unknown Resource";
          const subTitle =
            note
              .querySelector('.devsite-heading[role="heading"][aria-level="3"]')
              ?.textContent?.trim() || "No Subtitle";

          const typeElement =
            note.closest(".release-feature") ||
            note.closest(".release-changed");
          const type = typeElement?.classList.contains("release-feature")
            ? "feature"
            : typeElement?.classList.contains("release-changed")
            ? "changed"
            : "unknown";

          const content = typeElement
            ? typeElement.textContent
                ?.split("before")
                .slice(1)
                .join("before")
                .trim() || "No Content"
            : "No Content";

          return {
            release_at: releaseAt,
            resource_name: resourceName,
            type,
            sub_title: subTitle,
            content,
          };
        })
        .filter((note) => note !== null);
    }, lastReleasedAt);

    // Puppeteer の終了
    await browser.close();

    // API レスポンスとして返す
    res.json({ status: "success", notes: releaseNotes });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
