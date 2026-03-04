# Chrome Web Store Submission Checklist

## Account + Policy
- Create Chrome Web Store developer account.
- Pay one-time registration fee (often USD $5, confirm current amount in portal).
- Verify account details and policy acceptance.

## Prepare package
- Ensure extension folder is the upload root: extension/
- Confirm manifest version, version number, icons, and permissions are accurate.
- Remove debug-only artifacts.
- Zip only runtime files from extension/.

## Store listing assets
- Extension name and short description
- Full description (features + privacy + safety)
- Screenshots (at least 1, recommended 3-5)
- Optional promo tile/video link
- Category + language

## Required disclosures
- Data usage declaration (what is collected/sent to LLM providers)
- Permission justification for:
  - activeTab, tabs, scripting, storage
  - alarms, notifications, downloads, clipboardWrite
  - sidePanel, contextMenus, declarativeNetRequest
  - host permissions
- Privacy policy URL (recommended strongly if any external API is used)

## QA before submit
- Load unpacked extension/ in clean Chrome profile
- Run:
  - normal task
  - multi-agent research task
  - scheduler create/run
  - export audit log
- Ensure no console errors in service worker and popup

## Submit flow
1. Upload zip
2. Fill listing + disclosures
3. Save draft
4. Internal review checklist
5. Submit for review

## Post-submit
- Track review feedback
- Prepare quick patch release if needed
- Announce once published with store URL
