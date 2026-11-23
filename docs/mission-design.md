# How to develop the game: what a mission needs

The games are developed mission by mission: find a mission that is weak and fix it, or make up a
new one. This guide says what every mission must have, shows it on *Whose minutes?* (the train
dispatcher between three undertakings) and *The last wagon* (the yard master at the hump), and
lists the steps from the idea to the pull request.
The engine is described in [The game core](game-core.md), how the games look in
[Games](games.md#how-a-game-looks).

- [The brief](#the-brief): the standing instruction for work on the game
- [What every mission has](#what-every-mission-has): eight points, with what each means and how to check it
- [The example](#the-example-whose-minutes): how *Whose minutes?* meets them
- [A second example](#a-second-example-the-last-wagon): *The last wagon*, the yard master at the hump
- [From the idea to the pull request](#from-the-idea-to-the-pull-request)
- [What a mission must not be](#what-a-mission-must-not-be)

## The brief

The instruction this guide was written from, as the maintainer gave it:

> Find, fix or make up a mission for the game. Be inspired by the first one, it's relatively good.
> Make it interesting, with a clear educational aim. Always include unclear decisions, stochastic
> results, and negative role reaction, demanding for compromise. Include both discrete multiple
> choice decisions, scalar decisions and a gaming aspect, also include the virtual world somehow
> dynamically. After you're done, PR and watch and show me a walk-through.

"The first one" is *Your first shift*: a place on the lab's table, somebody who talks a beginner
through the first minutes and afterwards calls only when something does not go to plan, a table
to keep in view, and work that is done in the picture and not in a form.

## What every mission has

| | Point | What it means | How to check it |
| --- | --- | --- | --- |
| 1 | **A clear educational aim** | One sentence says what a player can do or explain afterwards that they could not before: a rule, a trade-off, a way to read a picture. It is in the mission's `text` ("What you practise: …"), and the `debrief` asks for it | Can the aim be said without the word "understand"? Does each question of the debrief need the played morning to answer? |
| 2 | **Unclear decisions** | No option is right for everybody. Each gives something up, and what it gives up is another role's or another train's. A decision with a right answer is a quiz: keep such questions short and few | Two fixed ways of playing, each defensible, score differently on different seeds, and neither is best on all (a test: "the choices matter") |
| 3 | **Results that are not certain** | What a decision leads to depends on something the player cannot know when deciding: a forecast that may be off, a cause found only on site, an explanation that is taken or not. The seed decides (`this.rng`), never `Math.random`, so a session can be played again | Another seed gives another outcome for the same answers; the same seed the same |
| 4 | **Roles that react, and ask for compromise** | The other roles are people with names and interests. They say what a decision did to them, their patience is a number that falls, and below a mark they act: a phone call that asks for something, a complaint, a refusal. What one of them is promised, another pays. The score counts the one who is worst off most | A way of playing that is good for two of three roles and bad for the third must not pass with three stars |
| 5 | **Decisions that are one of a few choices** | A question with two to four options, each a way to go (`ask` with `options`): who goes elsewhere, explain or promise | At least two such decisions in a play-through |
| 6 | **Decisions that are a number** | A question of how much: how many minutes, how many teams, what share (`ask` with `scale`, shown as a slider). Too little and too much must both cost, and the best number must depend on what is not certain | At least one in a play-through; both ends of the scale are worse than somewhere between on some seed |
| 7 | **A part that is played** | Something the player does by their own timing in the picture, not when asked: a route set, a van sent, a train tapped and its order changed when the forecast changes. Moves (`static actions`) offered from what is chosen in the picture; a clock that runs | The mission cannot be played as well by answering the questions alone as by also acting between them |
| 8 | **The layout's world in it, alive** | The mission is played on the lab's table (a board in `BOARDS`), and what is decided happens there: the train that is held stands at its platform with its doors open, the people wait for it, the freight train runs out in front of the intercity. The world is not a backdrop | Two different decisions give two different pictures on the table |

Besides these, what holds for every mission of the site ([Games](games.md#how-a-game-looks),
[missions as data](game-core.md#missions-as-data)): a `hook` of a line or two, a `place`, a
`story` in which somebody speaks first and lines `on` what does not go to plan, a `debrief` of at
least two questions, a seat for a person, and a computer player that passes it. People have bird
names; nothing is written on the table; the first sentence of a question's text carries the
dilemma (the rest is behind *More*).

## The example: Whose minutes?

The player is the train dispatcher (Zugdisponent/in) above the signal box of Bf Neustadt, 08:00
to 08:40, with the computer's signaller. Nine trains of three undertakings; the intercity, RB 33
and RB 35 come late, by forecasts that may be off by minutes.

| Point | In the mission |
| --- | --- |
| Aim | The dispatching rules of a line (a train on time before a late one, three minutes of waiting time), what an overtaking and a kept connection cost, reading a track occupation chart, deciding on a forecast, staying fair between undertakings |
| Unclear decisions | Let the freight train out before the late intercity (the intercity may crawl behind it to the next loop) or make it wait (it stands on the track RB 34 needs)? Hold RB 34 for a late feeder (everybody aboard pays, and the freight train behind it) or let it go (the changers wait half an hour)? |
| Results not certain | How late a train really comes (told only when it is on its way), how many change, whether the freight train's driver runs out of time when it stands, whether an explanation on the phone is taken |
| Roles that react | Three undertakings' dispatchers, each with a goodwill of 0 to 100 that falls with every minute added to their trains. Below 62 they phone ("GZ 47 stood 5 min for somebody else's train. What do I tell my customer?"): explain, promise their next train a clear run, or say sorry. Below 28 they write to the regulator, and the complaint is upheld where the orders left the rules. The lowest goodwill counts 60 % of that objective |
| One of a few | Which of two trains expected on one track goes elsewhere (keep, RB 33 to G1, GZ 49 to G3); the phone calls; the freight undertaking's wish for a clear run (promise, try, refuse) |
| A number | "RB 34 waits at most … min" and "GZ 47 waits at most … min", 0 to 8 in half minutes. A wait that ends before the feeder is in costs the minutes and the connection |
| Played | Tap a train on the table or in the chart and change its order while it stands: a minute more, no wait, another track before it comes. When the true lateness is told, the order given on the forecast may no longer fit |
| The world | The signaller's trains run on the lab's table by the orders: the freight train stands in G3 or runs out in front of the intercity, RB 33 runs into platform 1 and its passengers cross to platform 2, RB 34 stands with open doors until its wait is over |

Code: `web/arail/game/dispatcher.js`, `web/game/missions/whose-minutes.json`,
`web/game/dispatch.js`; tests in `tests/js/game-dispatcher.test.js` and `tests/e2e/dispatcher.spec.js`.

## A second example: The last wagon

The player is the yard master (Schichtleiter/in einer Zugbildungsanlage) of the hump yard west of
Bf Neustadt, 06:00 to 06:35 in the frost: the first mission of the freight roles. Four trains in,
four out, one hump, one locomotive.

| Point | In the mission |
| --- | --- |
| Aim | What a hump's pushing speed gains and costs, reading a train's list for good and bad runners, weighing a wagon's connection against a train's path at the cut-off, sharing one locomotive between jobs that all are urgent |
| Unclear decisions | Which of three waiting trains first: the one that came first, or the one with more wagons for the next cut-off? Push faster (the wagons are in sooner; a good runner catches up a bad one) or by the instructions? Hold the train for its last wagons (its path, its driver) or let it go (the wagons wait twelve hours)? The locomotive round the hump with the tank wagon now (the next train waits) or later (the wagon misses its train)? |
| Results not certain | How each wagon rolls (drawn by the seed, in the hump simulation's physics), so whether a switch gets between two cuts at 1.6 m/s; when the late train really comes; whether a path lost costs ten minutes or twenty-five; whether an explanation is taken |
| Roles that react | The hump operator (impacts, speed), the production dispatcher (minutes late), the customer service agent (wagons left behind), each with a patience of 0 to 100. Below 60 they phone and ask for a promise that another of them pays ("no train waits from now on" against "the 06:21 waits for its wagons"). Below 30 the operator stops the hump and pushes at walking pace from then on; the other two put it in writing. The lowest patience counts 60 % of that objective |
| One of a few | The next train for the hump; when the locomotive takes the wagon that must not be humped round, and when it fetches a cut from the wrong track; the three phone calls |
| A number | "56012 is pushed at … m/s" (0.8 to 2 in tenths) and "The 06:10 waits at most … min" (0 to 8 in half minutes). Too slow and too fast both cost, too short and too long too; the best number depends on how the wagons roll and when the late train comes |
| Played | Tap the hump while a train is pushed: faster, slower, stop and on again (slower just before a good runner follows a bad one). Tap a track: a minute more of waiting, no wait, close it up. Tap a cut in the wrong track: fetch it. Each of the locomotive's jobs takes its time, and the hump waits |
| The world | The layout's hump yard draws the game's own run of ARail's hump simulation: the train on the crest, the cuts through the retarders into the six tracks, a wagon red after an impact too hard, a track emptied when its train is pulled out. Pushed at 1.8, cuts stand in wrong tracks; pushed at 1.2, they do not |

What it added to the engine, for the next mission to use: a question without a time to answer by
(no train goes over the hump without the word; with nobody at the desk nothing moves, and the
shift fails by that), a game whose world is one of ARail's simulations (the hump's), and a table
that is another part of the layout than the station (a board names its modules, its area and its
parts).

Code: `web/arail/game/yard.js`, `web/game/missions/last-wagon.json`, `web/game/yard.js`; tests in
`tests/js/game-yard.test.js` and `tests/e2e/yard.spec.js`.

## From the idea to the pull request

1. **Find it.** Read the missions of the line (`web/game/missions/`) against the eight points:
   one that misses several is a mission to fix. For a new one, take a role of the catalogue
   ([Roles](roles.md)) whose mini game is described and whose flows the seated games already
   speak; look for the issues it answers (#148 to #155, the role games by family).
2. **Write the aim and the dilemma first**, in two sentences, before any code. If the dilemma has
   a right answer, it is not one.
3. **Build on what runs.** A mission is data: seats, phases, conditions, injects, a story. A new
   role game follows [Writing a role game](game-core.md#writing-a-role-game); where it needs
   something of another game (the signaller taking an order), that game learns it, with tests.
4. **Let the computer play it** on many seeds, with fixed ways of playing (by the book, nobody at
   the desk, the kind one, the hard one). Tune until nobody at the desk fails, the book passes,
   and judgment beats the book on some mornings and loses on others.
5. **Play it in the browser**, on the table, start to end. Read every question aloud: is the
   dilemma in its first sentence? Does somebody react to what was decided?
6. **Tests**: the game alone and in its mission (Node), the mission in the browser
   (`tests/e2e/`), and the checks of the site's missions (`tests/js/game-session.test.js` plays
   every mission with computers and with people who play at random).
7. **Documentation in the same change**: the guides ([Games](games.md),
   [The game core](game-core.md)), the role catalogue's `first` form and page
   (`web/game/roles/roles.json`, then `node tools/roles-md.mjs`), the architecture page's models,
   a changelog fragment.
8. **The pull request, watched, and a walk-through**: open the pull request (`Part of #N` for the
   issue it advances), follow its checks and reviews until it is green, and show the maintainer
   the mission played through, step by step with pictures: what is asked, what was answered,
   what came of it.

## What a mission must not be

- **A form to fill in.** What is decided is decided in the picture or in the band at the bottom,
  one question at a time.
- **A quiz in disguise.** If the debrief can be answered without having played, the mission
  taught a fact, not a judgment.
- **A script.** What is asked comes from the state of the game (a train that is late, a goodwill
  below its mark), not from a list of times. Only the mission's story has times.
- **Fair to nobody.** A role that only loses whatever is decided teaches helplessness. Every
  reaction must be one the player could have softened by another decision.
- **Closed to everybody but its author.** Its numbers are constants with a comment, its rules
  are in the architecture page's model, and its test says what must hold.
