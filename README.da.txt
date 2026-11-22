DUKA

Styr DUKA-ventilationsenheder fra Homey på dit lokale netværk. Appen taler
direkte med enheden over UDP uden en cloudtjeneste.

UNDERSTØTTEDE MODELLER

- DUKA One S6W og lignende varmegenvindingsenheder: blæserhastighed,
  ventilationstilstand, luftfugtighed, filterstatus og nulstilling af filter.
- DUKA smart-ventilatorer: boost, 24-timers tilstand, intervalventilation,
  lydsvag og maksimal hastighed, luftfugtighed, rumtemperatur og blæserens
  omdrejningstal.

Appen registrerer modellen under parringen og viser kun de funktioner, enheden
rapporterer.

FUNKTIONER

- Blæserstyring: til/fra, lav, mellem, høj og manuel hastighed på
  varmegenvindingsenheder.
- Ventilationstilstand: ind/ud, ind og ud på varmegenvindingsenheder.
- Smart-ventilator: boost, 24-timers tilstand, intervalventilation samt
  lydsvag og maksimal hastighed.
- Sensorer: luftfugtighed, rumtemperatur og omdrejningstal afhængigt af
  modellen.
- Filteralarm og resterende filterlevetid, med en vedligeholdelseshandling til
  at nulstille filtertiden.
- Flowkort til tilstande, hastigheder, boost, 24-timers tilstand,
  intervalventilation, filter og tilhørende triggere.
- Netværkssøgning under parring, med manuel indtastning af enheds-id og
  IP-adresse som fallback.

KRAV

- Homey Pro (Early 2023 eller nyere) eller Homey Self-Hosted Server med adgang
  til det lokale netværk. Appen virker ikke på Homey Cloud.
- DUKA-enheden på samme netværk eller adresserbar via en rute.
- Enheds-id'et fra DUKA-appen. Standardadgangskoden er 1111.

PRIVATLIV

Appen kommunikerer kun med enhederne på dit lokale netværk. Den sender ikke
data til nogen cloudtjeneste og indsamler ikke analyser.

Dette er en uofficiel app uden tilknytning til DUKA Ventilation. Protokollen er
dokumenteret af ha-dukaone-projektet.

Kildekode og fejlrapportering:
https://github.com/SorenHJohansen/homey-dukaone
