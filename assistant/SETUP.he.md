# הקמת המערכת — מדריך התקנה (עברית)

מערכת "CEO HQ" כבר חיה: מבנה התיקיות והטבלאות נוצר בדרייב, והסוכנים מוגדרים בריפו.
נשארו 2 צעדים ידניים שרק אתה יכול לעשות.

## צעד 1: חשבון גוגל נפרד (לבקשתך)

מסד הנתונים נוצר בדרייב שמחובר כרגע ל-Claude (**shmulik.mos@gmail.com**).
כדי שהמסד יישב בחשבון נפרד:

1. פתח/בחר את חשבון הגוגל הנפרד (למשל `ceo.hq.shmulik@gmail.com`).
2. בדרייב של החשבון הראשי — קליק ימני על התיקייה **"CEO HQ – מטה ניהול"** → שיתוף → הוסף את החשבון הנפרד כ-**Editor** (או העבר בעלות: שיתוף → ⚙ → העברת בעלות).
3. ב-Claude (claude.ai → Settings → Connectors → Google Drive) — חבר את החשבון **הנפרד** במקום/בנוסף לראשי.

זהו. הקבצים עצמם לא זזים — כל ה-fileId-ים ב-`assistant/config/database.json` נשארים תקפים גם אחרי שיתוף/העברת בעלות.

## צעד 2: Service Account — הזרוע הכותבת של הסוכנים

הסוכנים קוראים מהדרייב דרך המחבר של Claude, אבל כדי **לעדכן שורות בטבלאות** הם צריכים
Service Account (חשבון שירות של גוגל — זהות נפרדת משלך, בדיוק ברוח הבקשה).

1. עקוב אחרי המדריך הקיים `GOOGLE_SHEETS_SETUP.md` שלבים 1–4 (יצירת פרויקט, הפעלת Google Sheets API, יצירת Service Account והורדת מפתח JSON). אפשר להשתמש באותו Service Account של הסקרייפר אם כבר קיים.
2. שמור את הקובץ כ-`credentials.json` בשורש הריפו (הוא ב-.gitignore — לא יעלה לגיט. ודא זאת: `git check-ignore credentials.json`).
3. פתח את `credentials.json`, העתק את `client_email` (נראה כמו `xxx@yyy.iam.gserviceaccount.com`).
4. בדרייב — שתף את התיקייה **"CEO HQ – מטה ניהול"** עם כתובת זו בהרשאת **Editor** (שיתוף תיקייה מחיל על כל הטבלאות בתוכה).
5. (אופציונלי) הוסף ל-`.env`: `GOOGLE_CREDENTIALS_PATH="./credentials.json"` — זו גם ברירת המחדל.

## בדיקה

```bash
npm install                       # אם עוד לא הותקן
node assistant/db/cli.js tables   # אמור להציג את 11 הטבלאות
node assistant/db/cli.js list leads
node assistant/db/cli.js add tasks '{"Entity":"Personal","Task":"בדיקת מערכת","Priority":"נמוכה","Status":"פתוח"}'
node assistant/db/cli.js report
```

## התאמות מומלצות

- **שמות אמיתיים לישויות:** החלף `Company-A` / `Company-B` בשמות החברות האמיתיים — גם בערך `entities` ב-`assistant/config/database.json`, גם בשמות התיקיות בדרייב, וגם בעמודת Entity בשורות קיימות.
- **מחיקת שורות הדוגמה:** בכל טבלה יש שורת דוגמה אחת (מסומנת "שורת דוגמה - ניתן למחוק").
- **שימוש:** פשוט דבר עם Claude בריפו הזה — "קיבלתי ליד חדש מ...", "מה מצבי היום?", "סכם את הישיבה...". ה-CLAUDE.md ינתב אוטומטית לסוכן הנכון.
