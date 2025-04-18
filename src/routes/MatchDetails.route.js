// routes/matchRoutes.js
import express from "express";
import { asyncHandler } from "../utils/AsyncHandler.js";
import MatchDetails from "../models/MatchDetails.model.js";
import { authorizeAdmin, verifyJWT } from "../middlewares/auth.middleware.js";
import Player from "../models/Player.model.js";
import Team from "../models/Team.model.js";
import Tournament from "../models/Tournament.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { calculatePoints } from "../utils/calculatePoints.js";
import mongoose from "mongoose";

const router = express.Router();

// Route for adding match details
router.post(
  "/add",
  verifyJWT,
  authorizeAdmin,
  asyncHandler(async (req, res) => {
    const {
      matchNumber,
      matchName,
      playersPlayedTeam1,
      playersPlayedTeam2,
      score,
      goalsScoredBy,
      cardsObtained,
      penaltiesMissed,
      tournament_id,
      penaltySaves,
      ownGoals,
      // matchType,
    } = req.body;

    // Validate required fields
    if (
      !matchNumber ||
      !matchName ||
      !playersPlayedTeam1 ||
      !playersPlayedTeam2 ||
      !score ||
      !tournament_id ||
      !penaltySaves ||
      !ownGoals
      // !matchType
    ) {
      throw new ApiError(400, "All required fields must be provided");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate tournament ID
      const tournament = await Tournament.findById(tournament_id)
        .populate("matches")
        .session(session);
      if (!tournament) {
        throw new ApiError(400, "Invalid tournament ID");
      }

      // Initialize the `matches` array if it doesn't exist
      if (!tournament.matches) {
        tournament.matches = [];
      }

      // Validate player IDs
      const validatePlayerIds = async (playerIds) => {
        for (const playerId of playerIds) {
          const player = await Player.findById(playerId).session(session);
          if (!player) {
            throw new ApiError(400, `Invalid player ID: ${playerId}`);
          }
        }
      };
      // console.log("playersPlayedTeam1", playersPlayedTeam1);
      // console.log("playersPlayedTeam2", playersPlayedTeam2);

      await validatePlayerIds(playersPlayedTeam1);
      await validatePlayerIds(playersPlayedTeam2);
      if (goalsScoredBy) {
        for (const goal of goalsScoredBy) {
          const player = await Player.findById(goal.player).session(session);
          if (!player) {
            throw new ApiError(
              400,
              `Invalid player ID in goalsScoredBy: ${goal.player}`
            );
          }
          if (goal.assists) {
            await validatePlayerIds(goal.assists);
          }
        }
      }
      if (cardsObtained) {
        if (cardsObtained.yellow) {
          await validatePlayerIds(cardsObtained.yellow);
        }
        if (cardsObtained.red) {
          await validatePlayerIds(cardsObtained.red);
        }
      }
      if (penaltiesMissed) {
        await validatePlayerIds(penaltiesMissed);
      }

      // Check if a match with the same matchNumber already exists in the tournament
      // Check if any match in the populated matches array has the same matchNumber
      const matchExists = tournament.matches.some(
        (match) => match.matchNumber === matchNumber
      );

      if (matchExists) {
        throw new ApiError(
          400,
          `Match number ${matchNumber} already exists in this tournament`
        );
      }

      // Create the match details document
      const match = await MatchDetails.create(
        [
          {
            matchNumber,
            matchName,
            playersPlayedTeam1,
            playersPlayedTeam2,
            score,
            goalsScoredBy,
            cardsObtained,
            penaltiesMissed,
            tournament: tournament_id,
            ownGoals,
            penaltySaves,
            // matchType,
          },
        ],
        { session }
      );

      if (!match) {
        throw new ApiError(500, "Failed to add match details");
      }
      console.log("This is what match returns when a match is added", match);

      // Add the match to the tournament's matches array and save the tournament
      tournament.matches.push(match[0]._id);
      await tournament.save({ session });

      // Fetch all players involved in the match
      // ⚠️✅(but this array contains repeatition as playersPlayedTeam1 and goalsScoredBy might contains sam players)->that's the reason we are taking just playersPlayedTeam1 and playersPlayedTeam2
      // Fetch all players involved in the match
      const allPlayerIds = [
        ...playersPlayedTeam1,
        ...playersPlayedTeam2,
        // Uncomment and include other player arrays as needed
        // ...goalsScoredBy.map((goal) => goal.player),
        // ...goalsScoredBy.flatMap((goal) => goal.assists),
        // ...cardsObtained.yellow,
        // ...cardsObtained.red,
        // ...penaltiesMissed,
      ];

      //how efficient is this by matching/finding whole Player database to find the players involved in the match
      const players = await Player.find({
        tournamentId: tournament_id,
        _id: { $in: allPlayerIds },
      }).session(session);
      // console.log("players",players);

      // Calculate points for players
      const playerPoints = calculatePoints(match[0], players);
      console.log("player Points from match Details route", playerPoints);

      // Update player matches array
      for (const { playerId, matchNumber, points } of playerPoints) {
        const player = await Player.findById(playerId).session(session);
        if (player) {
          player.matches.push({ matchNumber, points });
          await player.save({ session });
        }
      }
      console.log("tournamentId", tournament_id);

      // Update team points for all the user team's
      const teams = await Team.find({
        tournamentId: tournament_id,
        $or: [
          { "players.final": { $exists: true, $ne: [] } },
          { "players.semifinal": { $exists: true, $ne: [] } },
          { "players.knockout": { $exists: true, $ne: [] } },
        ],
      }).session(session);
      console.log("teams", teams);

      for (const team of teams) {
        //for each franchise team create teamPlayers and teamType
        console.log("team", team);
        let teamPlayers = [];
        let teamType = "";

        if (team.players.final.length > 0) {
          teamPlayers = team.players.final;
          teamType = "final";
        } else if (team.players.semifinal.length > 0) {
          teamPlayers = team.players.semifinal;
          teamType = "semifinal";
        } else if (team.players.knockout.length > 0) {
          teamPlayers = team.players.knockout;
          teamType = "knockout";
        }

        console.log("playerPoints", playerPoints);
        const matchPoints = teamPlayers.map((playerId) => {
          const playerPoint = playerPoints.find(
            //find method is method of javascript that returns first matching value in an array
            (pp) => pp.playerId.toString() === playerId.toString()
          );
          return {
            playerId,
            points: playerPoint ? playerPoint.points : 0,
          };
        });
        console.log("matchPoints for the team", matchPoints);

        const matchNumberPoints = await matchPoints.reduce(
          //calculate current match points of the team
          (acc, curr) => acc + curr.points,
          0
        );

        await team.points.push({
          matchNumber,
          teamType,
          players: matchPoints,
          matchNumberPoints,
        });

        // Calculate totalPoints
        team.totalPoints = await team.points.reduce(
          (acc, curr) => acc + curr.matchNumberPoints,
          0
        );
        await team.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      res
        .status(201)
        .json(
          new ApiResponse(201, match[0], "Match details added successfully")
        );
    } catch (error) {
      await session.abortTransaction();
      console.error(error);
      session.endSession();
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, "Failed to add match Details");
    }
  })
);

export default router;
