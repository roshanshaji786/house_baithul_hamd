# Launch kit

Everything needed to publish Home Finish Visualizer and help people find it: a go-live checklist, search and social settings, and ready-to-post copy for each platform. Edit the posts into your own voice. Real stories ("I'm building my house and…") travel much further than feature lists.

**Links used below**
- Live demo: https://roshanshaji786.github.io/house_baithul_hamd/
- Repository: https://github.com/roshanshaji786/house_baithul_hamd

---

## 1. Go-live checklist (about 10 minutes)

1. **Merge the work into `main`.** The repository's front page and the live demo both come from `main`.
2. **Turn on the live demo:** *Settings › Pages › Build and deployment › Source: **GitHub Actions***. Then open *Actions › Deploy live demo › Run workflow* (it also runs on every push to `main`). After a minute or two the demo is live at the URL above.
3. **Fill in the "About" box** (gear icon next to *About* on the repo page):
   - **Description:**
     > See your unfinished house finished. Turn photos of bare walls into styled rooms with a before/after slider, 5 styles, reference images, one-element edits and a 3D walkthrough with MP4 export. Free, private, runs in your browser.
   - **Website:** `https://roshanshaji786.github.io/house_baithul_hamd/`
   - **Topics** (GitHub search weighs these heavily):
     `home-renovation` `interior-design` `house-design` `construction` `before-and-after` `room-planner` `virtual-staging` `ai-interior-design` `3d-walkthrough` `threejs` `webgl` `webcodecs` `image-editing` `openai` `gemini` `claude` `javascript` `nodejs` `open-source` `indian-interior-design`
4. **Social preview image:** *Settings › General › Social preview › Edit › Upload* `docs/images/social-preview.jpg`. This is the card shown when the repo link is shared.
5. **Create a release:** *Releases › Draft a new release*, tag `v1.0.0`, title "v1.0.0 – See your unfinished house finished", paste the notes from `CHANGELOG.md`, and attach a walkthrough MP4 made in the app. Releases appear in followers' feeds.
6. **Pin the repository** on your GitHub profile (*Customize your pins*).
7. **Google Search Console:** add a *URL prefix* property for the demo URL. Verify it by downloading Google's HTML verification file into `public/` and pushing. Then submit `sitemap.xml` and request indexing for the homepage. Do the same in **Bing Webmaster Tools**.
8. Check the share card with the [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) and by pasting the link into a WhatsApp chat.

## 2. What's already done for search and sharing

- The page has a keyword-rich `<title>` and meta description, a canonical URL, **Open Graph** and **Twitter card** tags with a 1200×630 image (`public/assets/og-image.jpg`), and **JSON-LD** (`WebApplication` + `FAQPage`) for rich results.
- It is installable as an app (`manifest.webmanifest` with icons) and has a crawlable "About & FAQ" section in plain HTML, plus `robots.txt` and `sitemap.xml`.
- The README is written for search: clear headings with the terms people search ("before and after", "interior design", "unfinished house", "3D walkthrough"), alt text on every image, and badges.
- `package.json` has a description, keywords, homepage and repository links.

## 3. Ready-to-post copy

Lead with the **before/after GIF** (`docs/images/before-after-slider.gif`) or the **five-styles image** (`docs/images/one-photo-five-styles.jpg`). Visual posts get far more reach than text.

### X / Twitter thread

> **1/** I'm building a house, and the hardest part is imagining it finished while standing in bare brick and concrete.
>
> So I built a free tool: upload a photo of an unfinished room → see it finished in your style. 👇
> [before/after GIF]
>
> **2/** One photo, five styles: modern minimalist, Scandinavian, luxury, Indian modern, industrial loft.
> [five-styles image]
>
> **3/** Add your own reference images and tell it what each one controls (floor, kitchen, colour palette, furniture). It keeps YOUR room's layout and warns you when a reference doesn't fit.
>
> **4/** Change just one thing: only the floor, only the paint, only the kitchen cabinets. Everything else stays the same.
>
> **5/** Then walk through the whole house in 3D, and download the walkthrough as an MP4 to send to family or your builder. 🏠🎬
> [walkthrough GIF]
>
> **6/** It's free, needs no sign-up, and runs in your browser, so your photos never leave your phone. Open source (MIT).
> Try it: https://roshanshaji786.github.io/house_baithul_hamd/
> Code: https://github.com/roshanshaji786/house_baithul_hamd
>
> **7/** Built with three.js, WebCodecs and a lot of perspective maths. Optional photo-real renders with OpenAI/Gemini if you self-host. Feedback and ⭐ very welcome!
>
> #buildinpublic #opensource #interiordesign #homerenovation #threejs

### LinkedIn

> 🏠 **I built a free tool that shows your unfinished house… finished.**
>
> Anyone who has built a home knows the problem: you stand in bare blockwork and have to pick floors, paint and lighting by imagination. Visualisers are expensive, and most "AI interior" apps want your photos on their servers.
>
> Home Finish Visualizer:
> ✅ Turns a phone photo of an unfinished room (or the house exterior) into a finished, styled space
> ✅ 5 styles, or your own reference images with roles (flooring, kitchen, palette…)
> ✅ Before/after slider and one-element-at-a-time edits
> ✅ 3D walkthrough with MP4 download for clients and family
> ✅ Free, no sign-up, runs entirely in your browser; open source (MIT)
>
> Homeowners and small contractors: I'd love your feedback.
> 👉 https://roshanshaji786.github.io/house_baithul_hamd/
>
> #construction #interiordesign #homebuilding #proptech #opensource #webdevelopment

### Hacker News (Show HN)

**Title:** `Show HN: See your unfinished house finished – in-browser renders and 3D walkthrough`

> I'm building a house and wanted to preview finishes on the actual rooms, from phone photos of bare walls. This is a free web app that fits a "room box" to a single photo (far wall + vanishing point), repaints floor/walls/ceiling with procedural materials multiplied by the photo's own smoothed lighting, places three.js furniture in metric space (avoiding detected doorways), and projects the result back onto a 3D box for a walkthrough ("tour into the picture"). The MP4 is encoded in the browser with WebCodecs + mp4-muxer.
>
> No account, no upload: everything is client-side. Self-hosting adds optional OpenAI/Gemini photo-real renders with role-tagged reference images.
>
> Demo: https://roshanshaji786.github.io/house_baithul_hamd/ – Code (MIT): https://github.com/roshanshaji786/house_baithul_hamd
>
> Limitations: it assumes straight-on, one-point-perspective photos, and the free renderer is stylised rather than photo-real. Happy to answer questions about the approach.

### Reddit

Read each subreddit's self-promotion rules first; some only allow it on certain days or in specific threads.

- **r/SideProject, r/webdev, r/javascript, r/threejs, r/opensource**: use the Show HN text, adjusted to each audience.
- **r/HomeImprovement, r/HomeBuilding, r/InteriorDesign, r/IndianHomes**: lead with the problem and the before/after image, mention it's free and private, and ask for feedback rather than upvotes.

**Title idea:** *I made a free tool that shows your unfinished room finished (works from a phone photo, nothing uploaded)*

### Product Hunt

- **Name:** Home Finish Visualizer
- **Tagline (≤ 60 characters):** `See your unfinished house finished – free, in your browser`
- **Description:** Upload a photo of bare walls and see the room finished in your style. Before/after slider, one-element edits, 3D walkthrough and MP4 video. No sign-up; photos never leave your device.
- **Gallery:** social preview, before/after GIF, five-styles image, bedroom/kitchen/exterior pairs, walkthrough GIF.
- **First comment:** the "why" story, what's free versus optional, and a question for hunters ("what style should we add next?").

### Instagram Reels / YouTube Shorts / TikTok

Screen-record the app on a phone (9:16):
1. Hook (0–2 s): "POV: your house is still bare brick…"
2. Upload a photo → press Render → drag the before/after slider.
3. Flip through the five styles.
4. Play the 3D walkthrough.
5. End card: "Free – link in bio".

**Caption:** *Can't picture your unfinished house? I built a free tool that shows it finished – in 5 styles, plus a 3D walkthrough 🏠✨ Link in bio. #homebuilding #interiordesign #beforeandafter #houseconstruction #homedecor*

### WhatsApp / Facebook groups (house builders, contractors, family)

> Building or renovating? This free tool shows your unfinished room finished, from just a phone photo. Try different floors, paint and lighting, then download a 3D walkthrough video. Nothing gets uploaded. https://roshanshaji786.github.io/house_baithul_hamd/

## 4. Tips

- **Post when your audience is awake** (for example 8–10 am in their time zone), and reply to every comment in the first few hours. Early engagement drives reach.
- **Use your own house.** A real before/after from an actual site is the most shareable thing you have (with consent from anyone involved).
- **Be upfront about limits.** It is a preview, not a photo-real render or a construction plan. Honesty earns trust (and upvotes) on HN and Reddit.
- **Ask for something specific:** feedback, a style request, or a ⭐ "so others can find it".
- **Ship small updates** (a new style, a new material) and post them. Each one is another chance to be seen.

No checklist can guarantee a viral post, but a live demo, a strong visual and a genuine story give it the best chance.
