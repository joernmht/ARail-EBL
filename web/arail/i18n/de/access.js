/**
 * The framework's texts in German: street access (core/access.js); trams, railway crossings and parking in the street access (core/access.js).
 * Part of web/arail/i18n/de.js; English text → German.
 * @module arail/i18n/de/access
 */
export const TEXTS = {
  // ------------------------------------------------------------ street access (core/access.js)
  "{name}: people cannot get there: no street or footpath within {n} m of its ways in": "{name}: Fußgänger kommen nicht hin: keine Straße und kein Fußweg im Umkreis von {n} m um die Zugänge",
  "{name}: buses cannot stop here: it is not right next to a street for buses": "{name}: Busse können hier nicht halten: sie liegt nicht direkt an einer Straße für Busse",
  "{name}: buses cannot drive in: no street within {n} m of its bus lane": "{name}: Busse können nicht einfahren: keine Straße im Umkreis von {n} m um die Busspur",
  "{name}: buses cannot drive out: no street within {n} m of its bus lane": "{name}: Busse können nicht ausfahren: keine Straße im Umkreis von {n} m um die Busspur",
  "{name}: trucks cannot get to it: no street at its entry (its first point)": "{name}: Lkw kommen nicht hin: keine Straße an der Einfahrt (dem ersten Punkt)",
  "{name}: trucks cannot leave it: no street at its end (its last point)": "{name}: Lkw kommen nicht weg: keine Straße am Ende (dem letzten Punkt)",
  "{name}: its vans cannot drive out: no street for cars within {n} m of its gate": "{name}: die Transporter kommen nicht heraus: keine Straße für Autos im Umkreis von {n} m um das Tor",
  "{name}: no street or footpath within {n} m of its entrance": "{name}: keine Straße und kein Fußweg im Umkreis von {n} m um den Eingang",
  "{names}: not connected to the other streets: no bus and no car comes from them": "{names}: nicht mit den anderen Straßen verbunden: von dort kommt kein Bus und kein Auto",
  "{name} ends {n} m before {other}: join them": "{name} endet {n} m vor {other}: verbinden Sie sie",
  "{name} ends inside the layout: cars appear and vanish here. Lead it to the edge of the layout, join it to another street, or make it a dead end": "{name} endet in der Anlage: hier tauchen Autos auf und verschwinden. Führen Sie sie zum Rand der Anlage, verbinden Sie sie mit einer anderen Straße, oder machen Sie daraus eine Sackgasse",
  "Add a footpath to {street}": "Fußweg zu {street} anlegen",
  "Add a street to {street}": "Straße zu {street} anlegen",
  "Add an underpass to {street}": "Unterführung zu {street} anlegen",
  "Add a street to the edge of the layout": "Straße zum Rand der Anlage anlegen",
  "Add a street out of the layout": "Straße aus der Anlage hinaus anlegen",
  "Join it to {street}": "Mit {street} verbinden",
  "Make it a dead end": "Daraus eine Sackgasse machen",

  // ------------------------------------------------------------ trams, railway crossings and parking in the street access (core/access.js)
  "{name}: trams cannot stop here: it is not at a tram track": "{name}: Straßenbahnen können hier nicht halten: sie liegt nicht an einem Straßenbahngleis",
  "{name}: trams cannot cross {other} at street level (BOStrab § 15): a bridge or an underpass is needed": "{name}: Straßenbahnen dürfen {other} nicht höhengleich kreuzen (BOStrab § 15): eine Brücke oder eine Unterführung ist nötig",
  "Make it a bridge over the track": "Daraus eine Brücke über das Gleis machen",
  "Build a bridge over the track": "Eine Brücke über das Gleis bauen",
  "{name} crosses {other} at street level without a railway crossing": "{name} kreuzt {other} höhengleich ohne Bahnübergang",
  "{name} meets {other} {n} m above the rails: not at their height, and too low for a bridge ({n2} m)": "{name} trifft {other} {n} m über den Schienen: nicht auf ihrer Höhe und zu niedrig für eine Brücke ({n2} m)",
  "{name} meets {other} {n} m below the rails: not at their height, and not deep enough for an underpass ({n2} m)": "{name} trifft {other} {n} m unter den Schienen: nicht auf ihrer Höhe und nicht tief genug für eine Unterführung ({n2} m)",
  "Add a level crossing with half barriers": "Einen Bahnübergang mit Halbschranken anlegen",
  "{name}: cars cannot get in: no street within {n} m of its way in": "{name}: Autos kommen nicht hinein: keine Straße im Umkreis von {n} m um die Einfahrt",
};
