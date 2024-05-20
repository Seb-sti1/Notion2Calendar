import process from "process";
import path, {resolve} from "path";
import {OAuth2Client} from 'google-auth-library';
import {google,} from 'googleapis';
import * as http from "node:http";
import {AddressInfo} from 'net';
import {UserRefreshClient} from "google-auth-library/build/src/auth/refreshclient";
import {DateRange} from "./notion";
import destroyer = require('server-destroy');
import arrify = require('arrify');

const fs = require('fs').promises;
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

export type CalendarClient = UserRefreshClient | OAuth2Client

export interface CalendarObject {
    id?: string,
    name: string,
    description: string,
    date: DateRange,
    lastEditedTime?: Date
}

/**
 * Reads previously authorized credentials from the save file.
 *
 */
async function loadSavedCredentialsIfExist(): Promise<UserRefreshClient | null> {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials) as UserRefreshClient;
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 */
async function saveCredentials(client: OAuth2Client): Promise<void> {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

function isAddressInfo(addr: string | AddressInfo | null): addr is AddressInfo {
    return (addr as AddressInfo).port !== undefined;
}

/**
 * Load or request or authorization to call APIs.
 *
 * This function is mostly from https://github.com/googleapis/nodejs-local-auth/blob/main/src/index.ts
 * the main modification is the addition of a print of the `authorizeUrl` because the url isn't open
 * when using a docker environment.
 */
export async function authorize(): Promise<CalendarClient> {
    let jsonClient = await loadSavedCredentialsIfExist();
    if (jsonClient) {
        return jsonClient;
    }

    const keyFile = require(resolve(CREDENTIALS_PATH));
    const keys = keyFile.installed || keyFile.web;
    if (!keys.redirect_uris || keys.redirect_uris.length === 0) {
        throw new Error("No valid redirect_uris provided.");
    }
    const redirectUri = new URL(keys.redirect_uris[0] ?? 'http://localhost');
    if (redirectUri.hostname !== 'localhost') {
        throw new Error("No valid redirect_uris provided.");
    }

    // create an oAuth client to authorize the API call
    const client = new OAuth2Client({
        clientId: keys.client_id,
        clientSecret: keys.client_secret,
    });

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url!, 'http://localhost:3000');
                if (url.pathname !== redirectUri.pathname) {
                    res.end('Invalid callback URL');
                    return;
                }
                const searchParams = url.searchParams;
                if (searchParams.has('error')) {
                    res.end('Authorization rejected.');
                    reject(new Error(searchParams.get('error')!));
                    return;
                }
                if (!searchParams.has('code')) {
                    res.end('No authentication code provided.');
                    reject(new Error('Cannot read authentication code.'));
                    return;
                }

                const code = searchParams.get('code');
                const {tokens} = await client.getToken({
                    code: code!,
                    redirect_uri: redirectUri.toString(),
                });
                client.credentials = tokens;
                resolve(client);
                res.end('Authentication successful! Please return to the console.');
                await saveCredentials(client)
            } catch (e) {
                reject(e);
            } finally {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (server as any).destroy()
            }
        });

        let listenPort = 3000;
        if (keyFile.installed) {
            // Use ephemeral port if not a web client
            listenPort = 0;
        } else if (redirectUri.port !== '') {
            listenPort = Number(redirectUri.port);
        }

        server.listen(listenPort, () => {
            const address = server.address();
            if (isAddressInfo(address)) {
                redirectUri.port = String(address.port);
            }
            const scopes = arrify(SCOPES || []);
            const authorizeUrl = client.generateAuthUrl({
                redirect_uri: redirectUri.toString(),
                access_type: 'offline',
                scope: scopes.join(' '),
            });

            // mod: print the url because of the docker env
            console.log(`Go to ${authorizeUrl}`)
        });
        destroyer(server);
    });
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param auth An authorized OAuth2 client.
 */
export async function listEvents(auth: CalendarClient, calendarId: string, numberOfDaysInPast: number): Promise<CalendarObject[]> {
    const calendar = google.calendar({version: 'v3', auth});
    let date = new Date()
    date.setDate(date.getDate() - numberOfDaysInPast)

    let events: CalendarObject[] = []

    let pageToken = null;
    let should_continue = true;
    while (should_continue) {
        const res = await calendar.events.list({
            calendarId: calendarId,
            timeMin: date.toISOString(),
            maxResults: 50,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken: pageToken,
        });


        if (!res.data.items || res.data.items.length === 0) {
            console.log('No upcoming events found.');
            return;
        }

        res.data.items.map((event) => {
            events.push({
                id: event.id,
                name: event.summary,
                description: event.description,
                date: {
                    start: new Date(event.start.dateTime || event.start.date),
                    end: new Date(event.start.dateTime || event.start.date),
                    isDateTime: event.start.dateTime != null
                },
                lastEditedTime: new Date(event.updated)
            })
        });
        pageToken = res.data.nextPageToken
        if (!pageToken) {
            should_continue = false
        }
    }

    return events
}