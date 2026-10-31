# LIA-söklogg

En enkel webbapp för att föra logg över LIA-ansökningar. Den följer kursens Excelmall ("Söklogg") och visar framsteg mot milstolparna på en översikt. Appen är skriven i vanlig JavaScript utan byggsteg, och all data sparas lokalt i webbläsaren (`localStorage`).

Projektet används också som övning i Google Analytics 4 (GA4) och Google Tag Manager (GTM).

## Funktioner

- Lägg till, redigera och ta bort ansökningar (datum, företag, ort, kontaktperson, titel, e-post, telefon, kontaktsätt, status, svar, intervju, erbjudande, kommentar, nästa steg, uppföljningsdatum, anteckningar).
- Sortering efter datum, nyast först.
- Filter på företag, status, intervju, erbjudande och uppföljning.
- Översikt över antal företag, uppföljningar, aktiv dialog, intervjuer och erbjudanden samt nästa deadline.
- Export till Excel som en fullständig kopia av mallen (`assets/lia-soklogg-mall.xlsx`) med rullgardiner och formler bevarade.
- Import från LIA-sökloggens Excelmall och bransch-tracker-export, med hantering av konflikter.
- Ljust och mörkt tema.

Vid import från bransch-tracker läggs motiveringen i Kommentar och Anteckningar i Övrigt. Rangordning importeras inte; datum och status lämnas tomma.

Datum skrivs som `yyyy-mm-dd`.

## Köra lokalt

Ingen installation krävs för att köra appen. Starta en statisk server i projektmappen:

```
py -m http.server 8000
```

Öppna sedan <http://127.0.0.1:8000/>.

Tester körs med:

```
npm install
npm test
```

(På Windows PowerShell: `npm.cmd`.)

## Publicera

Appen är statisk och kan publiceras med GitHub Pages (Settings → Pages → `main`, rot). Mallfilen `assets/lia-soklogg-mall.xlsx` måste följa med, eftersom exporten läser den.

## Analys (GA4 och GTM)

Mätning är frivillig och startar först när användaren tackar ja i samtyckesrutan. Innan dess laddas ingen Google-kod. Consent Mode sätter `analytics_storage` till `denied` tills samtycke finns.

Container-ID finns i `js/components/analyticsConsent.js` (`GTM_ID`). GA4-mätvärdes-ID ställs bara in i GTM-taggarna, inte i koden.

Appen skickar bara fasta etiketter till `dataLayer`. Aldrig företagsnamn, textinnehåll, filnamn eller filinnehåll.

| Event                    | Parametrar                    | När                                                                                               |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `feature_used`           | `feature_name`                | import, export, application_add, application_edit, application_delete, filter_reset, theme_toggle |
| `filter_used`            | `filter_field`, `filter_mode` | när ett filter ändras                                                                             |
| `application_field_used` | `field_name`, `save_type`     | ett event per ifyllt (ny) eller ändrat (redigering) fält vid sparning                             |

Alla pushar till `dataLayer` loggas i webbläsarens konsol som `[GTM dataLayer]`, vilket underlättar felsökning.

### Sätta upp i GTM

För varje event:

1. Skapa en Custom Event-trigger med eventets namn.
2. Skapa Data Layer Variables för parametrarna.
3. Skapa en GA4 Event-tagg med ditt mätvärdes-ID, parametrarna och extra samtycke `analytics_storage`.
4. Testa i Preview och publicera containern.

I GA4: registrera parametrarna (`feature_name`, `filter_field`, `filter_mode`, `field_name`, `save_type`) som anpassade dimensioner med omfång Händelse.

## Struktur

```
index.html          sidan och samtyckesrutan
styles.css
js/main.js          koppling mellan delarna
js/model/           datamodell, filter, sortering, milstolpar
js/state/           lagring och import
js/services/excel.js  Excel-import och -export (ExcelJS, laddas från CDN vid behov)
js/components/      gränssnittsdelar, bland annat analyticsConsent.js
assets/             Excelmall
tests/              tester
```
