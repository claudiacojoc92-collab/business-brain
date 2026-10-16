# Salvage before reject: acceptance on Blind Test 3 (2026-10-16)

Inputs: the stored Blind Test 3 snapshot and its 10 pages (read-only from production). Nothing written anywhere. Not
committed, not deployed. Content Romanian as generated; labels English.

## 1. The stored Blind Test 3 candidates, re-governed

The raw model output was not persisted before this change (the audit kept only the interpretation and the failing
clause); full candidates are now quarantined in `read.structureCandidates`. What could be re-governed:

- **Synthesis, original:** Oferta ta pare să combine mai multe modele operaționale sub un singur brand: clase de grup cu orar fix, servicii individuale cu programare (kinetoterapie, personal training, masaj) și programe structurate pe etape de viață (prenatal, postpartum). Nu știu încă dacă cele două locații funcționează ca un singur motor economic sau dacă fiecare are o compoziție de servicii și o echipă distinctă care le face să se comporte diferit.
- **Removed:** "programe structurate pe etape de viață (prenatal, postpartum)" (names an operating model by audience or life stage, not by how it is sold, delivered, booked or priced)
- **Salvaged:** Oferta ta pare să combine mai multe modele operaționale sub un singur brand: clase de grup cu orar fix și servicii individuale cu programare (kinetoterapie, personal training, masaj). Nu știu încă dacă cele două locații funcționează ca un singur motor economic sau dacă fiecare are o compoziție de servicii și o echipă distinctă care le face să se comporte diferit.
- **Verdict:** salvaged (was: rejected → fallback taxonomy).

- **Location hypothesis reversal:** "Dacă kinetoterapia se desfășoară și la Bună Ziua prin programări individuale care nu apar în orarul de clase publicat."
- **Verdict:** kept (was: dropped as a page condition because of the adjective "publicat"; the hypothesis was rejected).

- **Concentration hypothesis:** its two pattern sentences were schedule transcriptions; under salvage the pattern may
  empty and the evidence carries the facts, so it would now be judged on its interpretation, alternative and reversal
  (its alternative and reversal were not persisted, so it cannot be replayed).

## 2. Three fresh real-model passes (final prompt, final governance, one bounded repair round)

Model outputs and repair answers are from the fresh runs; the last two deterministic fixes (continuation items, unused-
capacity framing) were applied by replaying the same outputs and recorded repair answers (no new model call).

### Run 1

**What I think this business actually is**

> Nu toate serviciile par să fie intrate în același mod: clasele de grup se cumpără per ședință sau în abonament, în timp ce kinetoterapia și recuperarea postpartum individuală încep cu o evaluare plătită separată, care funcționează ca un prim pas obligatoriu înainte de orice abonament. Cele două locații nu au aceeași ofertă: Kinetoterapia apare în orarul de la Decebal dar nu în cel de la Bună Ziua, deși un kinetoterapeut este listat în echipa de la Bună Ziua. Nu știu încă dacă această diferență reflectă o specializare deliberată a locațiilor sau o limitare de spațiu și echipă.

Model wrote: "Nu toate serviciile par să fie intrate în același mod: clasele de grup se cumpără direct per ședință sau în abonament, în timp ce kinetoterapia și recuperarea postpartum individuală încep cu o evaluare plătită separată, care funcționează ca un prim pas obligatoriu înainte de orice abonament. Cele două locații nu au aceeași ofertă: Kinetoterapia apare în orarul de la Decebal dar nu în cel de la Bună Ziua, deși un kinetoterapeut este listat în echipa de la Bună Ziua. Nu știu încă dacă această diferență reflectă o specializare deliberată a locațiilor sau o limitare de spațiu și echipă."

**What I noticed**

- **Cele două locații par să aibă roluri diferite în ofertă: Bună Ziua pare orientată spre clase de grup, recuperare postpartum și masaj, iar Decebal pare să includă și kinetoterapia ca serviciu activ în orar. Prezența unui kinetoterapeut la Bună Ziua fără clase în orar poate însemna că serviciul se face prin programare individuală, nu în clase de grup.** Kinetoterapia apare în orarul de la Decebal (Kinetoterapie posturală copii 10-15 ani cu Yvette, Pilates Postural cu Yvette). Pagina de locații listează Kinetoterapia ca serviciu disponibil la Decebal și nu la Bună Ziua.
  - *Alternative:* Diferența poate reflecta disponibilitatea specialistului, spațiul fizic disponibil, cererea locală din fiecare cartier sau o decizie de testare a serviciului la o singură locație înainte de extindere.
  - *Evidence:* Locatii · Body Move Studio Decebal: "Servicii disponibile Clase & Personal Training · Kinetoterapie · Gimnastică Prenatală & Recuperare Postpartum · Masaj" | Locatii · Body Move Studio Bună Ziua: "Servicii disponibile Clase & Personal Training · Gimnastică Prenatală & Recuperare Postpartum · Masaj" | Body Move Studio Bună Ziua · Echipa Body Move Bună Ziua: "Ioana Urs Kinetoterapeut" | Programari · Orar Body Move Studio Decebal: "Marți 17:00 Kinetoterapie posturală (copii 10–15 ani) cu Yvette"

**What could change my read**

- Dacă kinetoterapia la Bună Ziua se face prin programare individuală cu volum similar celui de la Decebal, atunci diferența dintre locații este doar de format, nu de specializare.

**What I need from you**

- [A] Care serviciu aduce cel mai mare număr de ședințe vândute pe lună și care aduce cel mai mare venit lunar?
  - *Why I ask:* Răspunsul arată dacă miza principală a businessului este pe clasele de grup, pe kinetoterapie sau pe recuperarea postpartum, ceea ce schimbă unde merită investit în capacitate și echipă.
- [A] De unde vin clienții noi: recomandări de la medici sau alți specialiști, căutare online, rețele sociale, recomandări de la clienți existenți sau altceva?
  - *Why I ask:* Răspunsul arată care canale de achiziție sunt deja reale și care ar fi pariuri noi, ceea ce decide unde are sens să investești timp și bani pentru a aduce clienți noi.
- [B] Kinetoterapia apare în orarul de la Decebal, dar nu și la Bună Ziua, deși acolo există un kinetoterapeut în echipă: este aceasta o decizie deliberată de a concentra serviciul la Decebal, sau reflectă disponibilitatea specialistului, spațiul fizic ori cererea locală din cartier?
  - *Why I ask:* Răspunsul arată dacă locațiile sunt specializate deliberat.

**Salvage / repair record (quarantined)**

- synthesis: kept
- 0: repaired; removed 1 part(s): pattern: category confusion: it argues from what a page does not show; repaired: question
- 1: rejected; removed 1 part(s): pattern: category confusion: it argues from what a page does not show; it names fewer than two of this business's own things (generic)
- repair question (candidate 0): the question does not offer both sides of the fork (offers: representation) → "Kinetoterapia apare în orarul de la Decebal, dar nu și la Bună Ziua, deși acolo există un kinetoterapeut în echipă — este aceasta o decizie deliberată de a concentra serviciul la Decebal, sau reflectă disponibilitatea specialistului, spațiul fizic ori cererea locală din cartier?"

Stage hidden; readiness not_ready (missing intent, performance, acquisition).

### Run 2

**What I think this business actually is**

> Nu toate serviciile par să funcționeze după același mecanism de intrare: clasele de grup și masajul pot fi cumpărate cu abonament, în timp ce kinetoterapia și recuperarea postpartum încep cu o evaluare inițială plătită separată. Cele două locații par să aibă oferte parțial diferite, Decebal incluzând kinetoterapie iar Bună Ziua concentrând mai multe clase de grup și dans. Nu știu încă dacă cele două locații funcționează ca motoare independente sau dacă clienții circulă între ele.

Model wrote: "Nu toate serviciile par să funcționeze după același mecanism de intrare: clasele de grup și masajul pot fi cumpărate direct cu abonament, în timp ce kinetoterapia și recuperarea postpartum încep cu o evaluare inițială plătită separată. Cele două locații par să aibă oferte parțial diferite, Decebal incluzând kinetoterapie iar Bună Ziua concentrând mai multe clase de grup și dans. Nu știu încă dacă cele două locații funcționează ca motoare independente sau dacă clienții circulă între ele."

**What I noticed**

- **Decebal pare să fie singura locație unde kinetoterapia este oficial disponibilă ca serviciu, în timp ce Bună Ziua concentrează mai multe clase de grup, dans și recuperare prenatală și postpartum. Cele două locații pot servi profiluri de clienți parțial diferite.** Pagina de locații listează la Bună Ziua: Clase & Personal Training, Gimnastică Prenatală & Recuperare Postpartum, Masaj. La Decebal listează: Clase & Personal Training, Kinetoterapie, Gimnastică Prenatală & Recuperare Postpartum, Masaj.
  - *Alternative:* Kinetoterapia poate fi disponibilă și la Bună Ziua prin programare individuală, fără a apărea în orarul de clase de grup. Sau distribuția actuală poate reflecta disponibilitatea unui specialist, nu o decizie strategică deliberată.
  - *Evidence:* Locatii · Body Move Studio Bună Ziua: "Servicii disponibile Clase & Personal Training · Gimnastică Prenatală & Recuperare Postpartum · Masaj" | Locatii · Body Move Studio Decebal: "Servicii disponibile Clase & Personal Training · Kinetoterapie · Gimnastică Prenatală & Recuperare Postpartum · Masaj"

**What could change my read**

- Dacă clienții circulă frecvent între cele două locații pentru servicii diferite, locațiile funcționează mai degrabă ca un sistem integrat decât ca două unități cu profiluri distincte.

**What I need from you**

- [A] Care servicii aduc cel mai mare număr de clienți activi azi, și care aduc cel mai mare venit lunar?
  - *Why I ask:* Răspunsul îmi spune dacă volumul și venitul vin din același serviciu sau din servicii diferite, ceea ce schimbă unde merită investit.
- [A] De unde vin clienții noi azi: recomandări, căutare online, social media, altceva?
  - *Why I ask:* Răspunsul îmi spune care canale sunt deja reale și care ar fi pariuri noi.
- [B] Kinetoterapia este listată ca serviciu doar la Decebal: este aceasta o alegere deliberată (specialist dedicat acelei locații, echipament specific), sau reflectă disponibilitatea actuală a specialistului, ori constrângeri de spațiu la Bună Ziua?
  - *Why I ask:* Răspunsul decide dacă cele două locații au roluri distincte în ofertă sau dacă diferența este doar de orar și specialist disponibil.

**Salvage / repair record (quarantined)**

- synthesis: kept
- 0: rejected; removed 0 part(s): it names fewer than two of this business's own things (generic)
- 1: repaired; repaired: question
- repair question (candidate 1): the question does not offer both sides of the fork (offers: no explanation) → "Kinetoterapia este listată ca serviciu doar la Decebal — este aceasta o alegere deliberată (specialist dedicat acelei locații, echipament specific), sau reflectă disponibilitatea actuală a specialistului, ori constrângeri de spațiu la Bună Ziua?"

Stage hidden; readiness not_ready (missing intent, performance, acquisition).

### Run 3

**What I think this business actually is**

> Nu toate serviciile par să fie intrate în același mod: clasele de grup se cumpără per ședință sau în abonament, în timp ce kinetoterapia și recuperarea postpartum individuală încep cu o evaluare plătită separată, care funcționează ca un prim pas obligatoriu înainte de orice abonament. Cele două locații nu au aceeași ofertă: Kinetoterapia apare în orarul de la Decebal dar nu în cel de la Bună Ziua, deși un kinetoterapeut este listat în echipa de la Bună Ziua. Nu știu încă dacă această diferență reflectă o specializare deliberată a locațiilor sau o limitare de spațiu și echipă.

Model wrote: "Nu toate serviciile par să fie intrate în același mod: clasele de grup se cumpără direct per ședință sau în abonament, în timp ce kinetoterapia și recuperarea postpartum individuală încep cu o evaluare plătită separată, care funcționează ca un prim pas obligatoriu înainte de orice abonament. Cele două locații nu au aceeași ofertă: Kinetoterapia apare în orarul de la Decebal dar nu în cel de la Bună Ziua, deși un kinetoterapeut este listat în echipa de la Bună Ziua. Nu știu încă dacă această diferență reflectă o specializare deliberată a locațiilor sau o limitare de spațiu și echipă."

**What I noticed**

- **Cele două locații par să aibă roluri diferite în ofertă: Bună Ziua pare orientată spre clase de grup, recuperare postpartum și masaj, iar Decebal pare să includă și kinetoterapia ca serviciu activ în orar. Prezența unui kinetoterapeut la Bună Ziua fără clase în orar poate însemna că serviciul se face prin programare individuală, nu în clase de grup.** Kinetoterapia apare în orarul de la Decebal (Kinetoterapie posturală copii 10-15 ani cu Yvette, Pilates Postural cu Yvette). Pagina de locații listează Kinetoterapia ca serviciu disponibil la Decebal și nu la Bună Ziua.
  - *Alternative:* Diferența poate reflecta disponibilitatea specialistului, spațiul fizic disponibil, cererea locală din fiecare cartier sau o decizie de testare a serviciului la o singură locație înainte de extindere.
  - *Evidence:* Locatii · Body Move Studio Decebal: "Servicii disponibile Clase & Personal Training · Kinetoterapie · Gimnastică Prenatală & Recuperare Postpartum · Masaj" | Locatii · Body Move Studio Bună Ziua: "Servicii disponibile Clase & Personal Training · Gimnastică Prenatală & Recuperare Postpartum · Masaj" | Body Move Studio Bună Ziua · Echipa Body Move Bună Ziua: "Ioana Urs Kinetoterapeut" | Programari · Orar Body Move Studio Decebal: "Marți 17:00 Kinetoterapie posturală (copii 10–15 ani) cu Yvette"

**What could change my read**

- Dacă kinetoterapia la Bună Ziua se face prin programare individuală cu volum similar celui de la Decebal, atunci diferența dintre locații este doar de format, nu de specializare.

**What I need from you**

- [A] Care serviciu aduce cel mai mare număr de ședințe vândute pe lună și care aduce cel mai mare venit lunar?
  - *Why I ask:* Răspunsul arată dacă miza principală a businessului este pe clasele de grup, pe kinetoterapie sau pe recuperarea postpartum, ceea ce schimbă unde merită investit în capacitate și echipă.
- [A] De unde vin clienții noi: recomandări de la medici sau alți specialiști, căutare online, rețele sociale, recomandări de la clienți existenți sau altceva?
  - *Why I ask:* Răspunsul arată care canale de achiziție sunt deja reale și care ar fi pariuri noi, ceea ce decide unde are sens să investești timp și bani pentru a aduce clienți noi.
- [B] Kinetoterapia apare în orarul de la Decebal ca ore de grup, dar nu în cel de la Bună Ziua, deși acolo există un kinetoterapeut în echipă: este aceasta o alegere deliberată (roluri diferite pentru cele două locații), sau reflectă disponibilitatea specialistului, spațiul fizic ori cererea locală?
  - *Why I ask:* Răspunsul arată dacă locațiile sunt specializate deliberat.

**Salvage / repair record (quarantined)**

- synthesis: kept
- 0: repaired; removed 1 part(s): pattern: category confusion: it argues from what a page does not show; repaired: question
- 1: rejected; removed 1 part(s): pattern: category confusion: it argues from what a page does not show; it names fewer than two of this business's own things (generic)
- repair question (candidate 0): the question does not offer both sides of the fork (offers: representation) → "Kinetoterapia apare în orarul de la Decebal ca ore de grup, dar nu în cel de la Bună Ziua, deși acolo există un kinetoterapeut în echipă — este aceasta o alegere deliberată (roluri diferite pentru cele două locații), sau reflectă disponibilitatea specialistului, spațiul fizic ori cererea locală?"

Stage hidden; readiness not_ready (missing intent, performance, acquisition).

