/* league.js — the real 2026 league: draft order, declared keepers, traded picks.
   Pure data. A fresh draft (live or mock) is seeded from this, so draft day
   starts with nothing to type. Everything here is still editable in Setup.

   Keeper ids are the join key into data/players.json. An id the pool does not
   carry is dropped on boot, so check any change here against that file. */
(function (global) {
  'use strict';

  var LEAGUE_2026 = {
    season: '2026',

    // Slot order for round 1. The snake reverses every round.
    teams: [
      'Eric', 'Dan', 'Cory', 'Doug', 'Matthew', 'Hunter', 'Marc',
      'Nica', 'Clinton', 'Nick', 'Ryan', 'Ken', 'Darren', 'Rick'
    ],
    mySlot: 12,

    // Declared keepers, three per team, after the off-season trades.
    keepers: {
      Eric:    ['martin-necas', 'evan-bouchard', 'lane-hutson'],
      Dan:     ['nikita-kucherov', 'mikko-rantanen', 'sam-reinhart'],
      Cory:    ['nathan-mackinnon', 'dylan-guenther', 'nick-suzuki'],
      Doug:    ['kirill-kaprizov', 'jack-eichel', 'wyatt-johnston'],
      Matthew: ['leon-draisaitl', 'jason-robertson', 'jake-guentzel'],
      Hunter:  ['quinn-hughes', 'cale-makar', 'jake-oettinger'],
      Marc:    ['kyle-connor', 'artemi-panarin', 'miro-heiskanen'],
      Nica:    ['mitch-marner', 'mark-scheifele', 'jeremy-swayman'],
      Clinton: ['macklin-celebrini', 'rasmus-dahlin', 'karel-vejmelka'],
      Nick:    ['connor-mcdavid', 'cole-caufield', 'jakub-dobes'],
      Ryan:    ['leo-carlsson', 'tim-st-tzle', 'sidney-crosby'],
      Ken:     ['david-pastrnak', 'connor-bedard', 'igor-shesterkin'],
      Darren:  ['jack-hughes', 'zach-werenski', 'brayden-point'],
      Rick:    ['auston-matthews', 'ivan-demidov', 'matthew-schaefer']
    },

    // Picks that changed hands, by overall pick number. Every team still
    // holds 21 picks. The four trades behind them:
    //   1. Cory: Draisaitl + #115 to Matthew for #24
    //   2. Eric: Oettinger + #196 to Hunter for #79
    //   3. Cory: L. Carlsson + #250 to Ryan for #123
    //   4. Cory: Dobes + #227 to Nick for #206
    trades: [
      { pick: 24,  from: 'Matthew', to: 'Cory' },
      { pick: 79,  from: 'Hunter',  to: 'Eric' },
      { pick: 115, from: 'Cory',    to: 'Matthew' },
      { pick: 123, from: 'Ryan',    to: 'Cory' },
      { pick: 196, from: 'Eric',    to: 'Hunter' },
      { pick: 206, from: 'Nick',    to: 'Cory' },
      { pick: 227, from: 'Cory',    to: 'Nick' },
      { pick: 250, from: 'Cory',    to: 'Ryan' }
    ]
  };

  global.League2026 = LEAGUE_2026;
})(window);
