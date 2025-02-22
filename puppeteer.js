const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const port = process.env.PORT || 8080;

// 固定値：lastReleasedAt として "February 17, 2025" を設定
const lastReleasedAt = "February 18, 2025";

app.get("/crawl", async (req, res) => {
  try {
    console.log("✅ Puppeteer を起動...");

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: false, // デバッグ用。デプロイ時は true に変更可能
    });

    const page = await browser.newPage();
    console.log("🌍 Google Cloud Release Notes のページを開く...");
    await page.goto("https://cloud.google.com/release-notes", {
      waitUntil: "networkidle2",
    });

    console.log("⌛ 5秒待機してコンテンツ読み込みを待ちます...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log("🔍 クロールを開始...");
    const releaseNotes = await page.evaluate((lastReleasedAt) => {
      // 要素のテキストを取得する補助関数
      function getTextContent(el) {
        return el?.textContent?.trim() || "Unknown";
      }

      // 各リリースセクションを取得
      const releases = Array.from(
        document.querySelectorAll("section.releases > section")
      );
      const uniqueNotes = new Set();
      const notesList = [];

      releases.forEach((releaseSection) => {
        // h2 要素の data-text 属性からリリース日を取得
        const h2Element = releaseSection.querySelector("h2");
        let releaseAt =
          h2Element?.getAttribute("data-text") || getTextContent(h2Element);
        if (!releaseAt) return;
        console.log(`📅 取得したリリース日: ${releaseAt}`);

        // リリース日が lastReleasedAt と同一またはそれ以前の場合はスキップ
        if (
          releaseAt === lastReleasedAt ||
          Date.parse(releaseAt) <= Date.parse(lastReleasedAt)
        ) {
          console.log(
            `⏩ スキップ: ${releaseAt} は ${lastReleasedAt} と同一またはそれ以前`
          );
          return;
        }

        // このセクション内の各リリースノート（製品名の要素）を取得
        const noteTitles = Array.from(
          releaseSection.querySelectorAll(".release-note-product-title")
        );
        noteTitles.forEach((noteTitle) => {
          const resourceName = getTextContent(noteTitle);
          // noteTitle の近く（祖先要素）から、type と content を取得する div を探す
          const parentDiv = noteTitle.closest("div") || releaseSection;
          // ここで、.release-feature または .release-changed の要素を取得
          const typeContentElement =
            parentDiv.querySelector(
              "div.release-feature, div.release-changed"
            ) ||
            releaseSection.querySelector(
              "div.release-feature, div.release-changed"
            );

          let type = "unknown";
          let content = "No Content";
          if (typeContentElement) {
            if (typeContentElement.classList.contains("release-feature")) {
              type = "feature";
            } else if (
              typeContentElement.classList.contains("release-changed")
            ) {
              type = "changed";
            }
            content = getTextContent(typeContentElement);
          }

          // サブタイトルは、ここでは任意に noteTitle の直近の h3 要素から取得（存在しなければ空文字）
          const subTitleElement = parentDiv.querySelector("h3");
          const subTitle = subTitleElement
            ? getTextContent(subTitleElement)
            : "";

          const uniqueKey = `${releaseAt}-${resourceName}-${subTitle}`;
          if (!uniqueNotes.has(uniqueKey)) {
            uniqueNotes.add(uniqueKey);
            notesList.push({
              release_at: releaseAt,
              resource_name: resourceName,
              type,
              sub_title: subTitle,
              content,
            });
          }
        });
      });

      return notesList;
    }, lastReleasedAt);

    console.log(
      `✅ クロール完了。取得したリリースノート数: ${releaseNotes.length}`
    );

    await browser.close();
    console.log("✅ Puppeteer を終了しました。");

    res.json({ status: "success", notes: releaseNotes });
  } catch (error) {
    console.error("❌ エラー発生:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
