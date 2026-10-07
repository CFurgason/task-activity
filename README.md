# Agent Task Report Dashboard

A static GitHub Pages dashboard that reads task-report data directly from Google Sheets.

## Data source

The dashboard is configured in `app.js`:

```js
const SHEET_ID = "1RrTxVhzt7iDnVCB0c_sUnUbqix7RKfaDe9NA0IdkBus";
const SHEET_GID = "0";
```

The sheet should use the same columns as `task_report_test.csv`. The sample CSV is only an example of the expected layout; the app fetches live data from Google Sheets.

For the browser to load the sheet, share it with anyone who has the link or publish it to the web.

## GitHub Pages

1. Push this folder to a GitHub repository.
2. In GitHub, open **Settings > Pages**.
3. Set the source to the repository branch and root folder.
4. Save, then open the Pages URL after GitHub finishes publishing.

No build step is required.
