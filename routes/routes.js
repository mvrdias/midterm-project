"use strict";

const express = require('express');
const router = express.Router();
const moment = require('moment');

const eventHelper = require('../lib/event-helpers.js');

const ENV = process.env.ENV || "development";
const knexConfig = require("../knexfile");
const knex = require("knex")(knexConfig[ENV]);
const shortid = require('shortid');


// Helper Function
function makeHash() {
  return shortid.generate() + shortid.generate();
}

// GET home page
router.get("/", (req, res) => {
  res.render("index");
});

// GET event proposal form page
router.get("/create", (req, res) => {
  res.render("event_proposal_form_page");
});

// GET event link share page
router.get("/events/:hash/share", (req, res) => {

  res.locals.hash = req.params.hash;
  res.locals.host = req.get('host');

  res.render("share_link_page");
});

// GET event proposal display page
router.get("/events/:hash", (req, res) => {
  const eventID = req.params.hash,
    db = eventHelper(knex);

  const eventInformation = [
    db.getEventSummary(eventID),
    db.getEventOrganizer(eventID),
    db.getEventDateOptions(eventID),
    db.getEventAttendees(eventID)
      .then(attendees => {
        const attendeeResponses = attendees.map(attendee => {
          return db.getEventAttendeeResponses(eventID, attendee.id)
            .then(attendeeResponses => {
              return {
                name: attendee.name,
                responses: attendeeResponses.map(response => {
                  return {
                    event_date_id: response.event_date_id,
                    response: response.event_date_response
                  }
                })
              }
            });
        });

        return Promise.all(attendeeResponses);
      })
  ];

  Promise.all(eventInformation)
    .then(([summary, organizer, dateOpts, responses]) => {

      res.locals.eventID = eventID;
      res.locals.summary = summary[0];
      res.locals.organizer = organizer[0];
      res.locals.dates = dateOpts.map(date => {
        return {
          id: date.id,
          date: moment(date.date).format("MMM Do")
        }
      });

      res.locals.attendeeResponses = responses;

      res.render("event_proposal_display_page")
    });
});


// POST event proposal form page
router.post("/events", (req, res) => {
  const urlHash = makeHash();

  const organizer = {
    name: req.body.organizerName,
    email: req.body.email
  };

  eventHelper(knex).createUser(organizer).then(id => {
    const newEvent = {
      hash_id: urlHash,
      title: req.body.proposedEventName,
      description: req.body.proposedEventDescription,
      organizer_id: Number(id)
    };

    return eventHelper(knex).createEvent(newEvent)
  })
    .then(() => {
      const eventDateOptions = {
        eventID: urlHash,
        dateOptions: req.body.proposedEventDates.split(",")
          .map(date => new Date(date))
          .sort((a,b) => {
            return a.getTime() - b.getTime();
          })
      };

      return eventHelper(knex).createEventDateOptions(eventDateOptions);
    })
    .then(() => {
      res.redirect(`/events/${urlHash}/share`)
    });
});


// POST add new attendee with their response
router.post("/api/v1/events/:hash/attendees", (req, res) => {
  const eventID = req.params.hash;

  const attendeeName = req.body.attendeeName.value,
    attendeeEmail = req.body.attendeeEmail.value,
    attendeeResponses = req.body.responses;

  const yesDateOptions = (attendeeResponses
    ? attendeeResponses.reduce((obj, item) => (obj[item.name] = item.value, obj), {})
    : {});

  if (!attendeeName || !attendeeEmail) {
    res.sendStatus(400);
  } else {
    const newUser = {
      name: attendeeName,
      email: attendeeEmail
    };

    eventHelper(knex).createUser(newUser)
      .then(attendeeID => {

        return Promise.all([
          attendeeID,
          eventHelper(knex)
            .getEventDateOptions(eventID)
        ]);
      })
      .then(([attendeeID, eventdateOpts]) => {

        const responses = eventdateOpts.map(dateOpt => {
          if (yesDateOptions[dateOpt.id]) {
            return {
              id: Number(dateOpt.id),
              response: true
            }
          }

          return {
            id: Number(dateOpt.id),
            response: false
          }
        });

        const attendeeResponses = {
          attendeeID: Number(attendeeID),
          responses: responses
        }

        return Promise.all([
          attendeeID,
          eventHelper(knex)
            .createUserResponses(attendeeResponses)
        ]);
      })
      .then(([attendeeID, responses]) => {
        res.status(201).send({ id: attendeeID[0] });
      })
      .catch(err => {
        console.log(err);
        res.sendStatus(500);
      });
  }
});

// PUT alter current session attendee
router.put("/api/v1/events/:hash/attendees/:id", (req, res) => {
  const eventID = req.params.hash,
    attendeeID = req.params.id,
    attendeeResponses = req.body.responses;

  const yesDateOptions = (attendeeResponses
    ? attendeeResponses.reduce((obj, item) => (obj[item.name] = item.value, obj), {})
    : {});

  eventHelper(knex).getEventDateOptions(eventID)
    .then(eventdateOpts => {
      const responses = eventdateOpts.map(dateOpt => {
        if (yesDateOptions[dateOpt.id]) {
          return {
            id: Number(dateOpt.id),
            response: true
          }
        }

        return {
          id: Number(dateOpt.id),
          response: false
        }
      });

      const updateAttendeeResponses = {
        attendeeID: attendeeID,
        responses: responses
      };

      return eventHelper(knex)
        .updateEventAttendeeResponses(updateAttendeeResponses);
    })
    .then(() => {
      res.sendStatus(200);
    })
    .catch(err => {
      console.log(err);
      res.sendStatus(500);
    });
});

module.exports = router;
