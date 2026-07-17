# חיבור מאובטח של Salesforce ל‑Claude (Cowork)

מדריך זה מסביר איך לחבר את Salesforce ל‑Claude/Cowork בצורה **רשמית, אמינה ומאובטחת**, כך שאפשר לבצע שאילתות (SOQL) ולצפות בנתוני ה‑CRM ישירות מהצ'אט — בלי לבנות ולתחזק שרת ביניים.

## הפתרון המומלץ: Salesforce Hosted MCP Servers

Salesforce מפעילה שרתי MCP רשמיים על התשתית שלה. היתרונות:

- **רשמי ונתמך** — מתוחזק על ידי Salesforce, לא קוד צד‑שלישי.
- **מאובטח** — אימות OAuth 2.0 עם PKCE דרך External Client App; אין שמירת סיסמאות או טוקנים אצלך.
- **מכבד הרשאות** — כל שאילתה רצה תחת המשתמש המחובר, כולל Profile, Permission Sets ו‑Field-Level Security.
- **אפשרות קריאה בלבד** — השרת `sobject-reads` מאפשר שליפה וצפייה בלבד, בלי יכולת לשנות נתונים.
- **בלי תשתית** — אין שרת לתחזק, אין סודות לאחסן, אין עדכוני גרסאות.

## שלב 1: הפעלת שרת ה‑MCP בסיילספורס

1. היכנסו ל‑Salesforce **Setup**.
2. חפשו **MCP Servers** ופתחו את הטאב **Salesforce Servers**.
3. הפעילו את השרת הרצוי. לצפייה ושאילתות בלבד מומלץ להתחיל עם:
   - **`sobject-reads`** — קריאה בלבד (מומלץ! מינימום הרשאות).
   - `sobject-all` — קריאה + כתיבה (רק אם באמת צריך לעדכן נתונים מהצ'אט).
   - שרתים נוספים: `flows`, `invocable-actions`, `data-cloud-sql`, `tableau-next`, `prompt-builder`.

## שלב 2: יצירת External Client App

1. ב‑Setup חפשו **External Client App Manager** ולחצו **New External Client App**.
2. מלאו את פרטי הבסיס (שם, אימייל איש קשר).
3. פתחו את **API (Enable OAuth Settings)** וסמנו **Enable OAuth**.
4. ב‑**Callback URL** הזינו:
   ```
   https://claude.ai/api/mcp/auth_callback
   ```
5. ב‑OAuth Scopes בחרו את המינימום הנדרש (גישת API + refresh token).
6. סמנו **Issue JSON Web Token (JWT)-based access tokens for named users** ובטלו אפשרויות אחרות שאינן נחוצות.
7. לחצו **Create**.
8. לאחר היצירה: **Settings ‏→ OAuth Settings ‏→ Consumer Key and Secret** — העתיקו את ה‑**Consumer Key**.

> ⏳ שימו לב: אפליקציה חדשה יכולה לקחת עד ~30 דקות עד שהיא פעילה מול לקוחות MCP.

## שלב 3: הוספת ה‑Connector ב‑Claude

1. ב‑claude.ai: **Settings ‏→ Connectors ‏→ Add custom connector**.
2. הזינו את כתובת השרת:
   - **Production:**
     ```
     https://api.salesforce.com/platform/mcp/v1/<SERVER-NAME>
     ```
   - **Sandbox / Scratch org:**
     ```
     https://api.salesforce.com/platform/mcp/v1/sandbox/<SERVER-NAME>
     ```
   לדוגמה, לשרת הקריאה‑בלבד: `https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads`
3. תחת **Advanced settings**, הדביקו את ה‑**Consumer Key** בשדה **OAuth Client ID**.
4. לחצו **Add**, ואז **Connect** — תועברו למסך התחברות של Salesforce לאישור OAuth.
5. לאחר האישור, ודאו שה‑connector מסומן כפעיל בצ'אט (Connectors settings בתוך השיחה).

## שימוש

לאחר החיבור אפשר לבקש מ‑Claude בשפה חופשית, למשל:

- "הצג את 10 ההזדמנויות (Opportunities) הפתוחות הגדולות ביותר"
- "כמה לידים נוצרו החודש, מפולח לפי מקור?"
- "הרץ SOQL‏: `SELECT Name, Amount, StageName FROM Opportunity WHERE IsClosed = false`"

## המלצות אבטחה

| המלצה | למה |
|---|---|
| התחילו עם `sobject-reads` בלבד | קריאה בלבד — אין סיכון לשינוי נתונים בטעות |
| משתמש ייעודי / Permission Set מינימלי | הצ'אט רואה רק מה שהמשתמש המחובר מורשה לראות |
| בדקו קודם ב‑Sandbox | אימות התהליך לפני חיבור ל‑Production |
| אל תבחרו scopes מיותרים ב‑OAuth | עקרון המינימום ההכרחי |
| סקרו את ה‑Login History ו‑Event Monitoring | מעקב אחרי שימוש ב‑API דרך ה‑connector |

## חלופות (לא מומלצות כברירת מחדל)

- **‏`@salesforce/mcp` (DX MCP Server)** — שרת מקומי דרך Salesforce CLI; מתאים ל‑Claude Desktop/Code על מחשב מקומי, לא ל‑Cowork בענן.
- **שרת MCP עצמאי (jsforce וכו')** — דורש פיתוח, אחסון סודות ותחזוקה שוטפת; מיותר כשקיים פתרון רשמי מנוהל.

## מקורות

- [Connect Claude with Salesforce Hosted MCP Servers (בלוג רשמי)](https://developer.salesforce.com/blogs/2026/05/connect-claude-with-salesforce-hosted-mcp-servers)
- [Configure Claude — Hosted MCP Servers (תיעוד רשמי)](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/claude.html)
- [Create an External Client App (תיעוד רשמי)](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/create-external-client-app.html)
- [Salesforce Hosted MCP Servers — Help](https://help.salesforce.com/s/articleView?id=platform.hosted_mcp_servers.htm&language=en_US&type=5)
- [Custom connectors ב‑Claude (מרכז העזרה)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
