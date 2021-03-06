// using test database
const app = require("../app");
const request = require("supertest");
const db = require("../db");

describe("Game Tests", () => {
  const players = [
    { playerName: "playerone", token: "" },
    { playerName: "playertwo", token: "" },
    { playerName: "playerthree", token: "" },
    { playerName: "playerfour", token: "" },
    { playerName: "playerfive", token: "" }
  ];
  const testpassword = "password";
  // global variables for current player
  let currentPlayer = {};
  let notCurrentPlayer = {};

  // setup and teardown of DB
  beforeEach(async () => {
    try {
      await db.query("DELETE FROM user_table");
      await db.query("DELETE FROM tables");
      await db.query("DELETE FROM users");
    } catch (e) {
      console.log(e);
    }

    await registerUser(players[0]);
    await loginUser(players[0]);
    await registerUser(players[1]);
    await loginUser(players[1]);
    await registerUser(players[2]);
    await loginUser(players[2]);
    await registerUser(players[3]);
    await loginUser(players[3]);
    await registerUser(players[4]);
    await loginUser(players[4]);

    currentPlayer = {};
    notCurrentPlayer = {};
  });

  const registerUser = async player => {
    await request(app)
      .post("/api/users/register")
      .send({
        name: player.playerName,
        password: testpassword,
        password2: testpassword
      });
  };

  const loginUser = async player => {
    // login users before requests
    const res = await request(app)
      .post("/api/users/login")
      .send({
        name: player.playerName,
        password: testpassword
      });

    player.token = res.body.token;
  };

  const joinGame = async (player, tableID) => {
    return await request(app)
      .post("/api/game/join/" + tableID)
      .set("Authorization", player.token)
      .send();
  };

  const getGame = async player => {
    return await request(app)
      .get("/api/game")
      .set("Authorization", player.token)
      .send();
  };

  const createGame = async (player, buyin) => {
    return await request(app)
      .post("/api/game/create/" + buyin)
      .set("Authorization", player.token)
      .send();
  };

  // const playersJoinGame = async () => {
  //   // first player has to create the table and others can join
  //   let tableID;
  //   await createGame(players[0], 10000).then(res => (tableID = res.body.id));
  //   const dbRes0 = await db.query(
  //     "select minplayers from tables WHERE id = $1",
  //     [tableID]
  //   );
  //   const numplayers = parseInt(dbRes0.rows[0].minplayers);

  //   let res;
  //   switch (numplayers) {
  //     case 2:
  //       res = await joinGame(players[1], tableID);
  //       break;
  //     case 3:
  //       await joinGame(players[1]), tableID;
  //       res = await joinGame(players[2], tableID);
  //     case 4:
  //       await joinGame(players[1], tableID);
  //       await joinGame(players[2], tableID);
  //       res = await joinGame(players[3], tableID);
  //     case 5:
  //       await joinGame(players[1], tableID);
  //       await joinGame(players[2], tableID);
  //       await joinGame(players[3], tableID);
  //       res = await joinGame(players[4], tableID);
  //     default:
  //       break;
  //   }

  //   return res;
  // };

  const setCurrentPlayer = async () => {
    await db
      .query(
        `
      SELECT username, currentplayer
      FROM user_table
      INNER JOIN users ON users.id = user_table.player_id
      WHERE currentplayer=true`
      )
      .then(async res => {
        // get current player
        currentPlayer = players.find(player => {
          return player.playerName === res.rows[0].username;
        });

        // get player who is not current
        notCurrentPlayer = players.find(player => {
          return player.playerName !== res.rows[0].username;
        });
      });
  };

  test("Guest cannot create a new game or join a game", async () => {
    expect.assertions(2);

    // test that create route is gated
    await request(app)
      .post("/api/game/create/999999")
      .send()
      .then(res => expect(res.statusCode).toBe(401));

    let tableID;

    await createGame(players[0], 222222).then(res => (tableID = res.body.id));

    // test that join route is gated
    await request(app)
      .post("/api/game/join/" + tableID)
      .send()
      .then(res => expect(res.statusCode).toBe(401));
  });

  test("User creates a new table with min buy in", async () => {
    expect.assertions(4);

    // test that a table was created with buy in of 999999
    await createGame(players[0], 999999).then(res => {
      expect(res.body.minbuyin).toBe(999999);
      // If I am the first player at a table, I see a sign saying that the table is waiting for more players. The state of the game in the DB is 'waiting'. A game cannot be marked as started without the minimum number of players
      expect(res.body.status).toBe("waiting");
    });

    // creating table again throws error
    await createGame(players[0], 44444).then(res => {
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("Already playing at another table");
    });
  });

  test("User logs in, joins a table", async () => {
    expect.assertions(8);

    let tableID;

    // create a game with player 1
    await createGame(players[0], 100000).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID).then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.minbuyin).toBe(100000);
      // game is marked as started once second player arrives
      expect(res.body.status).toBe("started");
    });

    // Second login with same player to check that user cannot sit at same table twice
    await joinGame(players[0], tableID).then(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body.minbuyin).toBe(100000);
      expect(res.body.id).toBe(tableID);
      expect(res.body.status).toBe("started");
    });
    await joinGame(players[1], tableID);
    await db
      .query("SELECT count(id) as playercount FROM user_table")
      .then(dbres => {
        expect(parseInt(dbres.rows[0].playercount)).toBe(2);
      });
  });

  // I can see other player's info once I join a table. I cannot see their cards.
  test("User can see basic info about other players", async () => {
    expect.assertions(2);

    // create a game with player 1
    await createGame(players[0], 333333).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID).then(res => {
      // I can see my(p2) name
      expect(
        res.body.players.find(
          player => player.username === players[1].playerName
        ).username
      ).toEqual(players[1].playerName);

      const otherPlayer = res.body.players.find(
        player => player.username === players[0].playerName
      );

      // I can see info about the other player except his cards
      expect(otherPlayer).toEqual({
        username: players[0].playerName,
        dealer: true,
        chips: expect.any(Number),
        bet: expect.any(Number),
        talked: false,
        cards: null,
        isBigBlind: true,
        isSmallBlind: false,
        currentplayer: false,
        lastaction: null,
        seated: true,
        utid: expect.any(Number),
        action_timestamp: null
      });
    });
  });

  test("Game start", async () => {
    expect.assertions(26);

    let tableID, activeGame, minplayers, numCardsPopped, deck, dbHands, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID).then(res => {
      activeGame = res.body;
    });

    // get deck after min players have joined
    await db
      .query("select minplayers, deck from tables where id = $1", [tableID])
      .then(dbRes => {
        minplayers = parseInt(dbRes.rows[0].minplayers);
        numCardsPopped = minplayers * 2;
        // Once a game starts, cards are shuffled and distributed, balance cards are placed in a deck
        // deck should have 52 minus number of cards held in hand
        deck = dbRes.rows[0].deck;
        expect(deck.length).toBe(52 - numCardsPopped);
      });

    // game API should not respond with entire deck
    expect(activeGame.deck).toBe(undefined);

    // check that the deck in the db doesn't have the cards held by the players
    await db.query("SELECT cards from user_table").then(dbRes => {
      dbHands = dbRes.rows.map(hand => hand.cards).reduce((arr, hand) => {
        return arr.concat(hand);
      }, []);
    });
    expect(deck).not.toContain(dbHands);
    expect(deck.length + dbHands.length).toBe(52);
    // Check that two cards are distributed to each player at the table
    expect(dbHands.length).toBe(numCardsPopped);

    const game1_player1 = activeGame.players.find(
      player => player.username === players[0].playerName
    );
    const game1_player2 = activeGame.players.find(
      player => player.username === players[1].playerName
    );
    // check that player1's cards are not visible in response but player2's cards are since we are logged in as player2
    expect(game1_player1.cards).toBe(null);
    expect(dbHands).toContain(game1_player2.cards[0]);
    expect(dbHands).toContain(game1_player2.cards[1]);

    // First user at table is identified as dealer and everyone else should not be a dealer
    expect(game1_player1.dealer).toBe(true);
    expect(game1_player2.dealer).toBe(false);

    // First player after dealer is identified as small blind, next as big blind. So in 2 player game, p1 is dealer, p2 is sb, p1 is bb
    expect(game1_player1.isSmallBlind).toBe(false);
    expect(game1_player2.isSmallBlind).toBe(true);
    expect(game1_player1.isBigBlind).toBe(true);
    expect(game1_player2.isBigBlind).toBe(false);

    // User has chips removed for buy in
    const buyinRes = await db.query("SELECT minbuyin from tables limit 1");
    const p1bankRes = await db.query(
      "SELECT bank from users where username = $1",
      [players[0].playerName]
    );
    const p2bankRes = await db.query(
      "SELECT bank from users where username = $1",
      [players[1].playerName]
    );
    expect(p1bankRes.rows[0].bank).toBe(buyin - buyinRes.rows[0].minbuyin);
    expect(p2bankRes.rows[0].bank).toBe(buyin - buyinRes.rows[0].minbuyin);

    // User has blind bets forced - update bets array. Player 1 is big blind, player 2 is smallblind
    expect(game1_player1.chips).toBe(buyin - activeGame.bigblind);
    expect(game1_player2.chips).toBe(buyin - activeGame.smallblind);
    expect(game1_player1.bet).toBe(activeGame.bigblind);
    expect(game1_player2.bet).toBe(activeGame.smallblind);

    // First player is identified and highlighted   // get currentPlayer - dealer +3, else last player -> p2
    expect(game1_player2.currentplayer).toBe(true);
    expect(game1_player1.currentplayer).toBe(false);

    const p1res = await getGame(players[0]);

    const activeGame2 = p1res.body;
    const game2_player1 = activeGame2.players.find(
      player => player.username === players[0].playerName
    );
    const game2_player2 = activeGame2.players.find(
      player => player.username === players[1].playerName
    );

    // check that player2's cards are not visible in response but player1's cards once we are logged in as player1
    expect(game2_player2.cards).toBe(null);
    expect(dbHands).toContain(game2_player1.cards[0]);
    expect(dbHands).toContain(game2_player1.cards[1]);

    // User can see list of game rules - small blind, big blind, max buy in, min buy in, min players, max players
    //User can see game information: pot, round name, betname, gamestate
    expect(activeGame2).toEqual(
      expect.objectContaining({
        smallblind: expect.any(Number),
        bigblind: expect.any(Number),
        minplayers: expect.any(Number),
        maxplayers: expect.any(Number),
        minbuyin: expect.any(Number),
        maxbuyin: expect.any(Number),
        pot: expect.any(Number),
        roundname: expect.any(String),
        status: expect.any(String)
      })
    );
  });

  // playing poker
  test("Game action - Check", async () => {
    expect.assertions(11);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot check.  - p1 in 2p game
    // const tableID = await getTableID();
    const uri = "/api/game/check";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    // if any of the other players have made bets then you can't check
    await db.query(
      `UPDATE user_table SET bet = bet + 10000
      where player_id != (select id from users where username = $1)`,
      [currentPlayer.playerName]
    );

    // current player should be allowed to check except if there are existing bets
    await request(app)
      .post(uri)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Check not allowed, replay please"
        });
      });

    await db.query(
      `UPDATE user_table SET bet = 0
      where player_id != (select id from users where username = $1)`,
      [currentPlayer.playerName]
    );

    await request(app)
      .post(uri)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        // Current user can check if other bets are 0
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Success");
      });

    // if I'm allowed to check then add 0 to my bet field
    // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).not.toBe(0);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("check");
      });
  });

  test("Game action - Fold", async () => {
    expect.assertions(8);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot fold.  - p1 in 2p game
    const uri = "/api/game/fold";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    // get bet amount prior to folding
    let betAmount = 0;
    await db
      .query(
        `SELECT bet FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        betAmount = dbRes.rows[0].bet;
      });

    // current player should be allowed to fold
    await request(app)
      .post(uri)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
      });

    // if I'm allowed to fold then set my bet field to 0
    // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).toBe(0);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("fold");
      });
  });

  test("Game action - Bet", async () => {
    expect.assertions(10);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot bet.  - p1 in 2p game
    const uri = "/api/game/bet/10";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    // get bet amount prior to betting
    let betLessThanChips = 0;
    let priorBetAmount = 0;
    await db
      .query(
        `SELECT chips, bet FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        betLessThanChips = parseInt(dbRes.rows[0].chips) - 10;
        priorBetAmount = parseInt(dbRes.rows[0].bet);
      });

    const uriLessThanChips = "/api/game/bet/" + betLessThanChips;

    // current player should be allowed to bet if he does have sufficient chips
    await request(app)
      .post(uriLessThanChips)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Success");
      });

    // // if I'm allowed to bet then set my bet field to bet amount
    // // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction, chips FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).toBe(
          betLessThanChips + priorBetAmount
        );
        expect(parseInt(dbRes.rows[0].chips)).toBe(10);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("bet");
      });
  });

  test("Game action - Bet All In", async () => {
    expect.assertions(10);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot bet.  - p1 in 2p game
    const uri = "/api/game/bet/10";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    // get bet amount prior to betting
    let betMoreThanChips = 0;
    let priorBetAmount = 0;
    let totalChips = 0;
    await db
      .query(
        `SELECT chips, bet FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        totalChips = parseInt(dbRes.rows[0].chips);
        betMoreThanChips = totalChips + 10;
        priorBetAmount = parseInt(dbRes.rows[0].bet);
      });

    const uriMoreThanChips = "/api/game/bet/" + betMoreThanChips;
    // try betting more than the number of chips the user has
    await request(app)
      .post(uriMoreThanChips)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        // see if I have sufficient number of chips. run all in code if I don't
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("All In");
      });

    // if I'm allowed to bet then set my bet field to bet amount
    // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction, chips FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).toBe(totalChips + priorBetAmount);
        expect(parseInt(dbRes.rows[0].chips)).toBe(0);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("all in");
      });
  });

  test("Game action - Call", async () => {
    expect.assertions(10);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot bet.  - p1 in 2p game
    const uri = "/api/game/call";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    //Match the highest bet
    const res = await db.query(
      `SELECT max(bet) as max
      FROM user_table
      WHERE table_id = (select table_id
                          from user_table
                          INNER JOIN users on users.id = user_table.player_id
                          where username = $1)`,
      [currentPlayer.playerName]
    );

    const maxBet = parseInt(res.rows[0].max);

    // get bet amount prior to betting
    let totalChips = 0;
    await db
      .query(
        `SELECT chips, bet FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        totalChips = parseInt(dbRes.rows[0].chips);
      });

    //set current bet to 0 to test bet matching
    await db.query(
      `UPDATE user_table SET bet = 0
         WHERE player_id = (select id from users where username = $1)`,
      [currentPlayer.playerName]
    );

    // current player should be allowed to bet if he does have sufficient chips
    await request(app)
      .post(uri)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Success");
      });

    // if I'm allowed to bet then set my bet field to bet amount
    // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction, chips FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).toBe(maxBet);
        expect(parseInt(dbRes.rows[0].chips)).toBe(totalChips - maxBet);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("call");
      });
  });

  // calling with max bet higher than my total chips
  test("Game action - Call - All In", async () => {
    expect.assertions(10);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // Non current user cannot bet.  - p1 in 2p game
    const uri = "/api/game/call";
    await request(app)
      .post(uri)
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // notCurrentPlayer is unauthorized
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({
          notallowed: "Wrong user has made a move"
        });
      });

    //Match the highest bet
    const res = await db.query(
      `SELECT max(bet) as max
        FROM user_table
        WHERE table_id = (select table_id
                          from user_table
                          INNER JOIN users on users.id = user_table.player_id
                          where username = $1)`,
      [currentPlayer.playerName]
    );

    const maxBet = parseInt(res.rows[0].max);

    const lessThanMax = maxBet - 10;
    //set current bet to 0 and chips to less than max to test bet matching - all in
    await db.query(
      `UPDATE user_table SET bet = 0, chips = $2
         WHERE player_id = (select id from users where username = $1)`,
      [currentPlayer.playerName, lessThanMax]
    );

    // current player should be allowed to bet if he does have sufficient chips
    await request(app)
      .post(uri)
      .set("Authorization", currentPlayer.token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("All In");
      });

    // if I'm allowed to bet then set my bet field to bet amount
    // set talked to true
    await db
      .query(
        `SELECT bet, talked, lastaction, chips FROM user_table where player_id = (select id from users where username = $1)`,
        [currentPlayer.playerName]
      )
      .then(dbRes => {
        expect(parseInt(dbRes.rows[0].bet)).toBe(lessThanMax);
        expect(parseInt(dbRes.rows[0].chips)).toBe(0);
        expect(dbRes.rows[0].talked).toBe(true);
        expect(dbRes.rows[0].lastaction).toBe("all in");
      });
  });

  // // table progresses from one round to next
  test("Game progresses", async () => {
    expect.assertions(42);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();

    // expecting currentplayer to be player2, notcurrentplayer to be p1
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // I can't bet less than highest bet on the table - p2 in 2p game, small blind
    await request(app)
      .post("/api/game/bet/1")
      .set("Authorization", currentPlayer.token)
      .send();

    // current player stays as p2
    await setCurrentPlayer();
    expect(currentPlayer.playerName).toBe(players[1].playerName);

    // smallblind calls - p2 in 2p game
    await request(app)
      .post("/api/game/call")
      .set("Authorization", currentPlayer.token)
      .send();

    // expecting currentplayer to be player1, notcurrentplayer to be p2
    await setCurrentPlayer();
    expect(currentPlayer.playerName).toBe(players[0].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[1].playerName);

    // check if roundname is deal
    await db
      .query("SELECT roundname FROM tables")
      .then(res => expect(res.rows[0].roundname).toBe("Deal"));

    // big blind checks
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();

    // and triggers progress event again
    // current player becomes non current and vice versa
    await setCurrentPlayer();
    expect(currentPlayer.playerName).toBe(players[1].playerName);
    expect(notCurrentPlayer.playerName).toBe(players[0].playerName);

    // sum of all bets match the pot amount - should be 2x big blind
    let bigBlind;
    await db.query("SELECT pot, bigblind FROM tables").then(res => {
      bigBlind = res.rows[0].bigblind;
      const expectedPot = bigBlind * 2;
      expect(res.rows[0].pot).toBe(expectedPot);
    });

    await db.query("SELECT roundbet, bet, talked FROM user_table").then(res => {
      // all bets are moved to roundBets - roundbets should have 1x big blind each
      expect(res.rows[0].roundbet).toBe(bigBlind);
      expect(res.rows[1].roundbet).toBe(bigBlind);
      // // bets are all set to 0
      expect(res.rows[0].bet).toBe(0);
      expect(res.rows[1].bet).toBe(0);
      // // all talked are set to false
      expect(res.rows[0].talked).toBe(false);
      expect(res.rows[1].talked).toBe(false);
    });

    await db.query("SELECT roundname, deck, board FROM tables").then(res => {
      // roundname changes to flop
      expect(res.rows[0].roundname).toBe("Flop");
      // burn a card and turn 3 - deck should have 4 less cards and board should have 3
      expect(res.rows[0].deck.length).toBe(44);
      expect(res.rows[0].board.length).toBe(3);
    });

    //--- All users check
    await setCurrentPlayer();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    await db.query("SELECT roundbet, bet, talked FROM user_table").then(res => {
      // all bets are moved to roundBets - roundbets should have 1x big blind each
      expect(res.rows[0].roundbet).toBe(bigBlind);
      expect(res.rows[1].roundbet).toBe(bigBlind);
      // // bets are all set to 0
      expect(res.rows[0].bet).toBe(0);
      expect(res.rows[1].bet).toBe(0);
      // // all talked are set to false
      expect(res.rows[0].talked).toBe(false);
      expect(res.rows[1].talked).toBe(false);
    });

    await db.query("SELECT roundname, deck, board FROM tables").then(res => {
      // roundname changes to turn
      expect(res.rows[0].roundname).toBe("Turn");
      // burn a card and turn 1 - deck should have 2 fewer cards and board should have 4
      expect(res.rows[0].deck.length).toBe(42);
      expect(res.rows[0].board.length).toBe(4);
    });

    //--- All users check
    await setCurrentPlayer();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    await db.query("SELECT roundbet, bet, talked FROM user_table").then(res => {
      // all bets are moved to roundBets - roundbets should have 1x big blind each
      expect(res.rows[0].roundbet).toBe(bigBlind);
      expect(res.rows[1].roundbet).toBe(bigBlind);
      // // bets are all set to 0
      expect(res.rows[0].bet).toBe(0);
      expect(res.rows[1].bet).toBe(0);
      // // all talked are set to false
      expect(res.rows[0].talked).toBe(false);
      expect(res.rows[1].talked).toBe(false);
    });

    await db.query("SELECT roundname, deck, board FROM tables").then(res => {
      // roundname changes to River
      expect(res.rows[0].roundname).toBe("River");
      // // burn a card and turn 1 - deck should have 2 fewer cards and board should have 5
      expect(res.rows[0].deck.length).toBe(40);
      expect(res.rows[0].board.length).toBe(5);
    });

    //--- All users check
    await setCurrentPlayer();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    await db.query("SELECT roundbet, bet, talked FROM user_table").then(res => {
      // at end of showdown roundbets are 0
      expect(res.rows[0].roundbet).toBe(0);
      expect(res.rows[1].roundbet).toBe(0);
      // // bets are all set to 0
      expect(res.rows[0].bet).toBe(0);
      expect(res.rows[1].bet).toBe(0);
    });

    await db.query("SELECT roundname, pot FROM tables").then(res => {
      // roundname changes to showdown
      expect(res.rows[0].roundname).toBe("Showdown");
      // pot is 0
      expect(res.rows[0].pot).toBe(0);
    });
  });

  // test certain losing hand against certain winning hand
  test("Game winner and loser testing", async () => {
    expect.assertions(3);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);
    // set current and non-current players
    await setCurrentPlayer();
    // sb calls
    await request(app)
      .post("/api/game/call")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Deal' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();
    // 'Flop' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Flop' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();
    // 'Turn' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Turn' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    // winner is decided - set player one with straight, player 2 with pair. expect player one to win, have all chips
    await db.query(
      `
      UPDATE tables SET board = '{8C,6H,7C,JC,6C}'
      WHERE id = (SELECT table_id FROM user_table where player_id = (SELECT id FROM users where username=$1))
      RETURNING *
      `,
      [currentPlayer.playerName]
    );

    let roundbet;
    await db
      .query(
        "UPDATE user_table SET cards = '{9C, TC}', chips=0 WHERE player_id = (SELECT id FROM users where username=$1) returning roundbet",
        [currentPlayer.playerName]
      )
      .then(res => (roundbet = res.rows[0].roundbet));

    await db.query(
      "UPDATE user_table SET cards = '{4H, KS}', chips=0 WHERE player_id = (SELECT id FROM users where username=$1)",
      [notCurrentPlayer.playerName]
    );

    // 'River' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'River' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    // expect player one to win, have all chips
    await db
      .query(
        "SELECT chips, rankname FROM user_table WHERE player_id = (SELECT id FROM users where username=$1)",
        [currentPlayer.playerName]
      )
      .then(res => {
        const expectedChips = roundbet * 2;
        expect(res.rows[0].chips).toBe(expectedChips);
        // verify straight flush
        expect(res.rows[0].rankname).toBe("Straight Flush");
      });

    // check for bankrupt - player 2 should be bankrupt, expect him deleted from db
    await db
      .query(
        "SELECT * FROM user_table WHERE player_id != (SELECT id FROM users where username=$1)",
        [currentPlayer.playerName]
      )
      .then(res => {
        // console.log("bankrupt", res.rows);
        expect(res.rows.length).toBe(0);
      });
  });

  // table progresses from one round to next - roundname changes back to 'Deal'
  test("Init new round", async () => {
    // play rounds past showdown with 2 players
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // set current and non-current players
    await setCurrentPlayer();
    // sb calls
    await request(app)
      .post("/api/game/call")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Deal' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();
    // 'Flop' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Flop' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();
    // 'Turn' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();
    // 'Turn' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();
    // 'River' 1st check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", currentPlayer.token)
      .send();

    // 'River' last check
    await request(app)
      .post("/api/game/check")
      .set("Authorization", notCurrentPlayer.token)
      .send();

    // verify that roundname is showdown
    await request(app)
      .get("/api/game/")
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => expect(res.body.roundname).toBe("Showdown"));

    // waiting 3 seconds
    await new Promise(res =>
      setTimeout(() => {
        res();
      }, 3500)
    );

    await request(app)
      .get("/api/game/")
      .set("Authorization", notCurrentPlayer.token)
      .send()
      .then(res => {
        // verify that roundname is deal
        expect(res.body.roundname).toBe("Deal");
        // cycle dealer clockwise - p2 should be dealer
        const resPlayers = res.body.players;
        const player = resPlayers.find(player => player.dealer === true);
        expect(player.username).toBe(players[1].playerName);
        // set pot to 0, empty deck in tables, empty board in tables
        expect(res.body.pot).toBe(0);
        expect(res.body.board).toEqual([]);

        // set each player last action to null, talked to false, cards to empty array
        expect(resPlayers[0].lastaction).toBe(null);
        expect(resPlayers[0].talked).toBe(false);
        expect(resPlayers[1].lastaction).toBe(null);
        expect(resPlayers[1].talked).toBe(false);
      }, 10000);
  });

  // If only one player left unfolded, then he wins the pot
  test(
    "Only one player left unfolded",
    async () => {
      expect.assertions(1);

      let tableID, buyin;
      buyin = 100000;
      // create a game with player 1
      await createGame(players[0], buyin).then(res => (tableID = res.body.id));

      // join game as player 2
      await joinGame(players[1], tableID);
      // set current and non-current players
      await setCurrentPlayer();

      // get sum of bets
      let totalBets;
      await db
        .query("SELECT SUM(bet) as bets FROM user_table")
        .then(res => (totalBets = res.rows[0].bets));

      // get current chips
      let notCurrentPlayerChips;
      let smallblind;
      await request(app)
        .get("/api/game/")
        .set("Authorization", notCurrentPlayer.token)
        .send()
        .then(res => {
          notCurrentPlayerChips = res.body.players.find(
            player => player.username === notCurrentPlayer.playerName
          ).chips;

          smallblind = res.body.smallblind;
        });

      // expected total chips = bets + existing chips - smallblind
      const expectedTotalChips =
        parseInt(totalBets) +
        parseInt(notCurrentPlayerChips) -
        parseInt(smallblind);

      // make 1 player fold
      await request(app)
        .post("/api/game/fold")
        .set("Authorization", currentPlayer.token)
        .send();

      // waiting 4 seconds
      await new Promise(res =>
        setTimeout(() => {
          res();
        }, 4000)
      );

      // bets added to pot
      // unfolded player doesn't need to do an action - end of round
      // unfolded player checks his table and sees chips plus pot amount
      await request(app)
        .get("/api/game/")
        .set("Authorization", notCurrentPlayer.token)
        .send()
        .then(res =>
          expect(
            res.body.players.find(
              player => player.username === notCurrentPlayer.playerName
            ).chips
          ).toBe(expectedTotalChips)
        );
    },
    10000
  );

  // User joins a game mid round
  test("User joins a game mid round", async () => {
    expect.assertions(33);
    let tableID, buyin;
    buyin = 100000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2
    await joinGame(players[1], tableID);

    // start a round with 2 players, call and check
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[1].token)
      .send();

    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();

    // expect 3 cards on board
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        expect(res.body.board.length).toBe(3);
      });

    // have player 3 join mid round
    await joinGame(players[2], tableID).then(res => {
      expect(res.statusCode).toBe(200);
      // player 3 should see board
      expect(res.body.board.length).toBe(3);
      // Only seated players get cycled for currentPlayer, SB, BB, dealer within round
      const thirdplayer = res.body.players.find(
        player => player.username === players[2].playerName
      );
      expect(thirdplayer.isSmallBlind).toBe(false);
      expect(thirdplayer.isBigBlind).toBe(false);
      expect(thirdplayer.currentplayer).toBe(false);
      expect(thirdplayer.dealer).toBe(false);
      // check that player 3 does not have any cards
      expect(thirdplayer.cards).toEqual([]);
    });

    // check that player 3 cannot do any actions
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body.notallowed).toBe("Not yet seated");
      });

    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body.notallowed).toBe("Not yet seated");
      });

    await request(app)
      .post("/api/game/fold")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body.notallowed).toBe("Not yet seated");
      });

    await request(app)
      .post("/api/game/bet/10")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body.notallowed).toBe("Not yet seated");
      });

    // cycle round to turn and check again - Only seated players get cycled for currentPlayer, SB, BB, dealer within round
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        const thirdplayer = res.body.players.find(
          player => player.username === players[2].playerName
        );
        expect(thirdplayer.isSmallBlind).toBe(false);
        expect(thirdplayer.isBigBlind).toBe(false);
        expect(thirdplayer.currentplayer).toBe(false);
        expect(thirdplayer.dealer).toBe(false);
      });

    // cycle round to river and check again - Only seated players get cycled for currentPlayer, SB, BB, dealer within round
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        const thirdplayer = res.body.players.find(
          player => player.username === players[2].playerName
        );
        expect(thirdplayer.isSmallBlind).toBe(false);
        expect(thirdplayer.isBigBlind).toBe(false);
        expect(thirdplayer.currentplayer).toBe(false);
        expect(thirdplayer.dealer).toBe(false);
      });

    // finish round
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();

    // wait 3 seconds
    await new Promise(res =>
      setTimeout(() => {
        res();
      }, 3500)
    );
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        const thirdplayer = res.body.players.find(
          player => player.username === players[2].playerName
        );
        // third player should be small blind
        expect(thirdplayer.isSmallBlind).toBe(true);
        expect(thirdplayer.isBigBlind).toBe(false);
        expect(thirdplayer.currentplayer).toBe(false);
        expect(thirdplayer.dealer).toBe(false);
        // check that player 3 has 2 cards
        expect(thirdplayer.cards.length).toBe(2);
      });

    // check that player 3 can do actions at his turn
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[2].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain("Success");
      });

    // More than maxplayers can't join
    await db.query("UPDATE tables SET maxplayers = 3");
    await joinGame(players[3], tableID).then(res => {
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("Maximum players alread seated.");
    });
  });

  // User exits a game
  test("User exits a 2 player game", async () => {
    // get p1 and p2 bank
    let p1BankInitial, p2BankInitial;
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankInitial = res.rows[0].bank));
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankInitial = res.rows[0].bank));

    let tableID, buyin, p1BankPost, p2BankPost;
    buyin = 20000;
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankPost = parseInt(res.rows[0].bank)));

    expect(p1BankInitial).toEqual(p1BankPost + buyin);

    // join game as player 2
    await joinGame(players[1], tableID);
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankPost = parseInt(res.rows[0].bank)));

    expect(p2BankInitial).toEqual(p2BankPost + buyin);

    // user exits before betting anything
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body.gameover).toContain("Success");
      });

    // p1 bank should be less his blind. - in 2p game, p1 is BB
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankPost = res.rows[0].bank));
    expect(p1BankPost).toEqual(p1BankInitial - 2000);

    // opponent gets kicked when only one player left
    // he banks his chips + pot amount
    // opponent bank should be as was before + BB
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankPost = res.rows[0].bank));
    expect(p2BankPost).toEqual(p2BankInitial + 2000);

    // table gets deleted
    await db.query("SELECT id FROM tables").then(res => {
      expect(res.rows.length).toBe(0);
    });

    // -------------------------------------- Exit after Deal -------------- //
    // resetting variables for p1 and p2 bank
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankInitial = res.rows[0].bank));
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankInitial = res.rows[0].bank));
    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));
    // join game as player 2
    await joinGame(players[1], tableID);
    // call and check so round changes to Turn
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/check")
      .set("Authorization", players[0].token)
      .send();

    // p1 exits when he has bet 2000 in the pot, and round is past deal
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[0].token)
      .send();
    // p1 bank should be -2000.
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankPost = res.rows[0].bank));
    expect(p1BankInitial).toEqual(p1BankPost + 2000);

    // p2 gets kicked out for there being only one player left.
    // p2 bank should be +2000
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankPost = res.rows[0].bank));
    expect(p2BankInitial).toEqual(p2BankPost - 2000);

    // no users or table left
    await db
      .query("SELECT id FROM user_table")
      .then(res => expect(res.rows.length).toBe(0));
    await db
      .query("SELECT id FROM tables")
      .then(res => expect(res.rows.length).toBe(0));
  });

  // User exits a game
  test("User exits a 3 player game", async () => {
    // get p1, p2 and p3 bank
    let p1BankInitial, p2BankInitial, p3BankInitial;
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankInitial = res.rows[0].bank));
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankInitial = res.rows[0].bank));
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[2].playerName
      ])
      .then(res => (p3BankInitial = res.rows[0].bank));

    let tableID, buyin, p1BankPost, p2BankPost, p3BankPost;
    buyin = 30000;

    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2 and 3
    await joinGame(players[1], tableID);
    await joinGame(players[2], tableID).then(res => {
      // p3 should be unseated, p1 and p2 should be seated
      expect(
        res.body.players.find(player => player.seated === false).username
      ).toBe(players[2].playerName);

      expect(
        res.body.players.find(player => player.seated === true).username
      ).toBe(players[0].playerName);
    });

    // p1 exits before betting anything
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
      });

    // p2 wins the round (wins the big blind amount) and next round has p2 and p3
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        const mychips = res.body.players.find(
          player => player.username === players[1].playerName
        ).chips;

        // 30000 - SB 1000 + SB 1000 + BB 2000 - BB 2000 because next round he is BB
        expect(mychips).toBe(30000);
      });

    // p1 bank should be as was before less BB.
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankPost = res.rows[0].bank));
    expect(p1BankPost).toEqual(p1BankInitial - 2000);

    // p2 and p3 play continue to Deal
    await request(app)
      .get("/api/game/call")
      .set("Authorization", players[2].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[1].token)
      .send();

    // p1 rejoins and is unseated
    await joinGame(players[0], tableID);

    // p2 and p3 play till turn
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[2].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[1].token)
      .send();

    // p2 and p3 leave
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[2].token)
      .send();

    // p1 bank should be 98000 + 2000 because a new round is started before p3 leaves. Therefore, p1 wins the pot
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankPost = res.rows[0].bank));
    expect(p1BankPost).toEqual(p1BankInitial);

    // p3 will get the pot but since he left after another round is started, he loses BB. +2000 -2000
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[2].playerName
      ])
      .then(res => (p3BankPost = res.rows[0].bank));
    expect(p3BankPost).toEqual(p3BankInitial);

    // no users or table left
    await db
      .query("SELECT id FROM user_table")
      .then(res => expect(res.rows.length).toBe(0));
    await db
      .query("SELECT id FROM tables")
      .then(res => expect(res.rows.length).toBe(0));
  });

  // test player exit from 4 player game
  test("User exits a 4 player game", async () => {
    // get p1, p2, p3, p4 bank
    let sumBankBeforeGame, sumBankAfterGame;
    await db
      .query(
        "SELECT sum(bank) as sumbank FROM users WHERE username=$1 OR username=$2 OR username=$3 OR username=$4 ",
        [
          players[0].playerName,
          players[1].playerName,
          players[2].playerName,
          players[3].playerName
        ]
      )
      .then(res => (sumBankBeforeGame = res.rows[0].sumbank));

    let tableID, buyin;
    buyin = 40000;

    // create a game with player 1
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));

    // join game as player 2, 3 and 4. 3 and 4 will be unseated
    await joinGame(players[1], tableID);
    await joinGame(players[2], tableID);
    await joinGame(players[3], tableID);

    // p1 exits before betting anything
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
      });

    // p2 wins the round (wins the big blind amount) and next round has p2, p3 and p4
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        const mychips = res.body.players.find(
          player => player.username === players[1].playerName
        ).chips;

        // 40000 - SB 1000 + SB 1000 + BB 2000
        expect(mychips).toBe(42000);
      });

    // p2, p3 and p4 play continue to Deal
    await request(app)
      .get("/api/game/call")
      .set("Authorization", players[2].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[2].token)
      .send();

    // p1 rejoins and is unseated
    await joinGame(players[0], tableID);

    // p2, p3, p4 play till turn
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[2].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .get("/api/game/check")
      .set("Authorization", players[2].token)
      .send();

    // p2, p3 and p4 leave
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[1].token)
      .send();
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[2].token)
      .send();
    await request(app)
      .post("/api/game/exit")
      .set("Authorization", players[3].token)
      .send();

    // final sum of bank balances should be same as before
    await db
      .query(
        "SELECT sum(bank) as sumbank FROM users WHERE username=$1 OR username=$2 OR username=$3 OR username=$4 ",
        [
          players[0].playerName,
          players[1].playerName,
          players[2].playerName,
          players[3].playerName
        ]
      )
      .then(res => (sumBankAfterGame = res.rows[0].sumbank));

    expect(sumBankBeforeGame).toEqual(sumBankAfterGame);

    // no users or table left
    await db
      .query("SELECT id FROM user_table")
      .then(res => expect(res.rows.length).toBe(0));
    await db
      .query("SELECT id FROM tables")
      .then(res => expect(res.rows.length).toBe(0));
  });

  // testing a DB based timer system
  test("User timed out attempts action", async () => {
    // get p1, p2 bank
    let p1BankInitial, p2BankInitial;
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankInitial = res.rows[0].bank));

    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankInitial = res.rows[0].bank));

    // p1 creates a game
    let tableID;
    let buyin = 12000;
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));
    // p2 joins a game
    await joinGame(players[1], tableID);

    // wait for timeout - update timestamp to future
    await db.query("UPDATE tables SET timeout = 0 WHERE id = $1", [tableID]);

    // p2 attempts action and fails - but the app immediately calls exittable on p2 which should return success
    await request(app)
      .post("/api/game/call")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body.gameover).toBe("Success");
      });

    // p2 gets kicked out
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual("Not in an active game");
      });

    // p1 gets kicked out because he was last player - get gameover message
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual("Not in an active game");
      });

    await db.query("SELECT * FROM user_table").then(dbres => {
      expect(dbres.rows.length).toBe(0);
    });

    await db.query("SELECT * FROM tables").then(dbres => {
      expect(dbres.rows.length).toBe(0);
    });

    // p1 has +1000 in bank
    // p1 + p2 is same as when game started
    await db
      .query("SELECT username, bank FROM users ORDER BY id")
      .then(dbres => {
        const p1BankPost = dbres.rows[0].bank;
        const p2BankPost = dbres.rows[1].bank;

        expect(p1BankPost).toBe(p1BankInitial + 1000);
        expect(p2BankPost).toBe(p2BankInitial - 1000);
        expect(p1BankPost + p2BankPost).toBe(p2BankInitial + p1BankInitial);
      });
  });

  // testing a DB based timer system when p1 has timed out and doesn't refresh or commit an action. P2 just waits for timeout, should win pot
  test("User timed out, opponent wins pot without any action", async () => {
    // get p1, p2 bank
    let p1BankInitial, p2BankInitial;
    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[0].playerName
      ])
      .then(res => (p1BankInitial = res.rows[0].bank));

    await db
      .query("SELECT bank FROM users WHERE username = $1", [
        players[1].playerName
      ])
      .then(res => (p2BankInitial = res.rows[0].bank));

    // p1 creates a game
    let tableID;
    let buyin = 12000;
    await createGame(players[0], buyin).then(res => (tableID = res.body.id));
    // p2 joins a game
    await joinGame(players[1], tableID);

    // wait for timeout - update timestamp to future
    await db.query("UPDATE tables SET timeout = 0 WHERE id = $1", [tableID]);

    // p1 refreshes game - visits /api/game - p2 gets kicked out and is not visible in response
    // p1 gets kicked out because he was last player
    await request(app)
      .get("/api/game/")
      .set("Authorization", players[0].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(200);
        expect(res.body.gameover).toEqual("Success");
      });
      await request(app)
      .get("/api/game/")
      .set("Authorization", players[1].token)
      .send()
      .then(res => {
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual("Not in an active game");
      });

    await db.query("SELECT * FROM user_table").then(dbres => {
      expect(dbres.rows.length).toBe(0);
    });

    await db.query("SELECT * FROM tables").then(dbres => {
      expect(dbres.rows.length).toBe(0);
    });

    // p1 has +1000 in bank
    // p1 + p2 is same as when game started
    await db
      .query("SELECT username, bank FROM users ORDER BY id")
      .then(dbres => {
        const p1BankPost = dbres.rows[0].bank;
        const p2BankPost = dbres.rows[1].bank;

        expect(p1BankPost).toBe(p1BankInitial + 1000);
        expect(p2BankPost).toBe(p2BankInitial - 1000);
        expect(p1BankPost + p2BankPost).toBe(p2BankInitial + p1BankInitial);
      });
  });

  // test all in player against part in - same as above but player 2 has less than max bet
  // test if winner has a part in 100 out of 300 in his roundBets against 1 player. i.e. His winnings should be +100 not +200. 100 should be returned to other player

  // test tie breaker - https://www.adda52.com/poker/poker-rules/cash-game-rules/tie-breaker-rules
  // two royal flushes - slpit pot
  // Two king high straight flush - split pot
  // A King High Straight Flush loses only to a Royal
  // A queen high Straight Flush beats a jack high
  // Both players share 4 of a kind of aces, winner is based on higher kicker. p1 has king kicker, p2 has q, p1 wins.
  // Both players share 4 of a kind of aces, winner is based on higher kicker. p1 and p2 have king kickers, split pot.
  // Aces full of deuces (AAA22) beats Kings full of Jacks (KKKJJ)
  // Aces full of deuces (AAA22) loses Aces full of Jacks (AAAJJ)
  // Aces full of deuces (AAA22) split pot with Aces full of deuces (AAA22)
  // A flush is any hand with five cards of the same suit. If two or more players hold a flush, the flush with the highest card wins. If more than one player has the same strength high card, then the strength of the second highest card held wins. This continues through the five highest cards in the player's hands
  // A straight is any five cards in sequence, but not necessarily of the same suit. If more than one player has a straight, the straight ending in the card wins. If both straights end in a card of the same strength, the hand is tied
  // If more than one player holds three of a kind, then the higher value of the cards used to make the three of kind determines the winner. If two or more players have the same three of a kind, then a fourth card (and a fifth if necessary) can be used as kickers to determine the winner.
  // The highest pair is used to determine the winner. If two or more players have the same highest pair, then the highest of the second pair determines the winner. If both players hold identical two pairs, fifth card is used to break the tie.
  // If two or more players hold a single pair, then highest pair wins. If the pairs are of the same value, the highest kicker card determines the winner. A second and even third kicker can be used if necessary.
  // When no player has even a pair, then the highest card wins. When both players have identical high cards, the next highest card wins, and so on until five cards have been used. In the unusual circumstance that two players hold the identical five cards, the pot would be split.
});
