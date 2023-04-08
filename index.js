const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// how long to wait between requests and actions (in milliseconds)
const WAIT_TIME_MS = 1000;

/**
 * Download, convert, and save all Level Palace (LP) levels
 * for the specified user as JSON files for Level Share Square (LSS).
 *
 * @returns
 */
const convertAndSaveLevels = async () => {
  // handle and save command line arguments
  if (process.argv.length < 4) {
    console.log(
      "Please supply a Level Palace username and Level Share Square user ID."
    );
    return;
  }
  let lpUsername = process.argv[2];
  // handle usernames with spaces
  if (lpUsername.match(/^"(.*)"$/))
    lpUsername = lpUsername.replace(/^"(.*)"$/, "$1");
  const lssUserID = process.argv[3];

  // variables
  const baseURL = `https://www.levelpalace.com/levels?creator=${encodeURIComponent(
    lpUsername
  )}&level_class=All&sort=newest&difficulty=all`;
  const levels = [];
  let currentPage = 1;
  let hasNextPage = true;

  // for each level page, get level info
  console.log(
    `Beginning conversion process of levels for user "${lpUsername}"...`
  );
  while (hasNextPage) {
    await sleep(WAIT_TIME_MS);

    const response = await axios.get(`${baseURL}&page=${currentPage}`, {
      headers: { "User-Agent": "lp-helper" },
    });
    const $ = cheerio.load(response.data);
    console.log(`Searching page ${currentPage} of LP levels...`);

    // stop if user has no levels
    if ($("div.table-container:contains('No levels found.')").length !== 0) {
      console.log("No levels were found!");
      return;
    }

    const levelCards = $("div.card-item", "div.card-blocks");

    // iterate through all levels on page
    for (let i = 0; i < levelCards.length; i++) {
      await sleep(WAIT_TIME_MS);

      const currentLevelCard = levelCards[i];
      const levelLink =
        "https://www.levelpalace.com/" +
        $(currentLevelCard).find("a.card-title").attr("href");

      // go to level page via link in card
      const pageResponse = await axios.get(levelLink, {
        headers: { "User-Agent": "lp-helper" },
      });
      const page$ = cheerio.load(pageResponse.data);

      // save all needed level info to be saved for json
      const levelName = page$("p.brand-logo", "div.level-section")
        .text()
        .trim();
      const levelCode = page$(
        "textarea.level-code-textarea",
        "div.level-code"
      ).text();

      // all level stats
      const levelStats = page$("li.collection-item", "ul.level-stats");
      let levelRating,
        levelGame,
        levelDifficulty,
        levelThumbnail,
        levelDescription,
        levelContributors;
      const levelDescriptionPane = page$(
        "li.collection-item",
        "ul.level-description"
      );

      // get all needed level stats
      for (let j = 0; j < levelStats.length; j++) {
        const currentLevelStat = levelStats[j];

        // determine which stat we are looking at
        switch (page$(currentLevelStat).find("strong").text().trim()) {
          case "Rating:":
            page$(currentLevelStat).find("strong").remove();
            levelRating =
              parseFloat(
                page$(currentLevelStat).text().trim().replace("%", "")
              ) / 20.0;
            break;
          case "Game:":
            page$(currentLevelStat).find("strong").remove();
            levelGame = page$(currentLevelStat).find("a").text().trim();
            break;
          case "Difficulty:":
            page$(currentLevelStat).find("strong").remove();
            levelDifficulty = page$(currentLevelStat).text().trim();
            break;
          default:
        }
      }

      // get level description stats
      for (let j = 0; j < levelDescriptionPane.length; j++) {
        const currentDescriptionStat = levelDescriptionPane[j];

        // get level thumbnail if one is present
        if (
          page$(currentDescriptionStat).find("div#level-images-slider")
            .length !== 0
        )
          levelThumbnail = page$(currentDescriptionStat)
            .find("div#level-images-slider")
            .find("ul.slides")
            .find("li")
            .find("img")
            .attr("src");

        // determine which stat we are looking at
        switch (page$(currentDescriptionStat).find("strong").text().trim()) {
          case "Description:":
            page$(currentDescriptionStat).find("strong").first().remove();
            levelDescription = page$(currentDescriptionStat).html().trim();
            break;
          case "Contributors:":
            page$(currentDescriptionStat).find("strong").remove();
            if (
              page$(currentDescriptionStat).text().trim() !==
              "No additional contributors."
            )
              levelContributors = page$(currentDescriptionStat).text().trim();
          default:
        }
      }

      // create and save level object for lss
      const levelObj = {
        name: levelName,
        author: lssUserID,
        code: levelCode,
        description: levelDescription,
        tags: [""],
        contributors: levelContributors
          ? levelContributors
              .split(",")
              .map((contributor) => contributor.trim())
          : [""],
        difficulty: levelDifficulty,
        game:
          levelGame === "Super Mario Construct"
            ? 0
            : levelGame === "Yoshi's Fabrication Station"
            ? 1
            : levelGame === "Super Mario 127"
            ? 2
            : 3,
        thumbnail: levelThumbnail ? levelThumbnail : "",
        status: "Public",
        plays: [],
        rates: [],
        raters: [],
        commenters: [],
        rating: levelRating,
        postDate: null,
      };
      levels.push(levelObj);

      console.log(`Successfully converted level with name "${levelName}".`);
    }

    // CHECK FOR NEXT PAGE OF LEVELS

    // get pagination buttons at bottom of page
    const pagination = $("li:not(.disabled):not(.active)", "ul.pagination");

    // iterate through all pagination buttons to find "next page" arrow
    for (let i = 0; i < pagination.length; i++) {
      const currentButton = pagination[i];
      const buttonText = $(currentButton)
        .find("a")
        .find("i.material-icons")
        .text();

      // if next page is found
      if (buttonText === "chevron_right") {
        currentPage++;
        break;
      }
      // if next page is never found
      else if (i === pagination.length - 1 && buttonText !== "chevron_right") {
        hasNextPage = false;
        console.log("Finished converting levels!");
        break;
      }
    }
  }

  // SAVE LEVELS TO JSON FILES FOR USER

  // iterate through all levels
  console.log("Saving levels as JSON for LSS...");
  let levelNum = 1;
  for (let i = levels.length - 1; i >= 0; i--) {
    await sleep(10);
    const level = levels[i];
    level.postDate = new Date();
    const levelJsonData = JSON.stringify(level, null, 2);

    if (!fs.existsSync(`./${lpUsername}`)) fs.mkdirSync(`./${lpUsername}`);

    try {
      fs.writeFileSync(`${lpUsername}/level-${levelNum}.json`, levelJsonData);
      console.log(`Successfully saved level with name "${level.name}".`);
    } catch (error) {
      console.error(error);
    }

    levelNum++;
  }

  console.log("Finished saving levels!");
  console.log(
    `All levels for user "${lpUsername}" have successfully been converted and saved!`
  );
};

/**
 * Sleep for "ms" milliseconds.
 *
 * @param {*} ms
 * @returns
 */
const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

convertAndSaveLevels().catch((error) => console.error(error));
