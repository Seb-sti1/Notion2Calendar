import {UserRefreshClient} from "google-auth-library/build/src/auth/refreshclient";
import {OAuth2Client} from "google-auth-library";
import path, {resolve} from "path";
import process from "process";
import {google} from "googleapis";
import {AddressInfo} from "net";
import http from "node:http";
import destroyer = require('server-destroy');
import arrify = require('arrify');

const fs = require('fs').promises;


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');


export type CalendarClient = UserRefreshClient | OAuth2Client


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
