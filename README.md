# Notion to GCalendar

This repository is meant to synchronise a collection from Notion
to Google Calendar.

## Installation

### Get a Google Calendar API key, Notion token and database id

See [Node.js quickstart](https://developers.google.com/calendar/api/quickstart/nodejs)
to create an app and save the credentials in the `credentials.json`.

Go on [My integrations](https://www.notion.so/my-integrations), create an integration and
save the secret in `.env` (see `example.env` as an example). You also need to add the database id
in the `.env` (see [the image in the first paragraphs](https://developers.notion.com/reference/retrieve-a-database) to
find how to get the database id).
Don't forget to go on the page of the database and
[Connect to](https://stackoverflow.com/questions/72396153/how-do-i-retrieve-a-site-using-notions-api)
the integration you just created.

### Development

To install packages:

```bash
npm i
```

To run use:

```bash
npm run dev
```

### Production

_WIP: Docker image_

## TODOS

- Production
- Check [watch](https://developers.google.com/calendar/api/v3/reference/events/watch?hl=fr)

## Useful link

- https://github.com/googleapis/google-auth-library-nodejs
- https://developers.google.com/calendar/api/quickstart/nodejs?hl=en
- https://github.com/makenotion/notion-sdk-js