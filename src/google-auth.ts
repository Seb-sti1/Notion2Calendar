import {OAuth2Client} from "google-auth-library";
import path, {resolve} from "path";
import process from "process";
import {AddressInfo} from "net";
import http from "node:http";
import arrify from 'arrify';
import destroyer = require('server-destroy');

const fs = require('fs').promises;


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

interface TokensFile {
    access_token: string,
    refresh_token: string,
}

interface KeyFile {
    client_id: string,
    client_secret: string,
    redirect_uris: string[],
}

export type CalendarClient = OAuth2Client


/**
 * Reads previously authorized credentials from the save file.
 *
 */
async function loadJSON<T>(path: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(path));
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 */
async function saveCredentials(client: OAuth2Client): Promise<void> {
    await fs.writeFile(TOKEN_PATH, JSON.stringify({
        access_token: client.credentials.access_token,
        refresh_token: client.credentials.refresh_token,
    }));
}

/**
 * Tries to authenticate to the Google Account with no prior information.
 * It WILL require the user to give consent.
 *
 * @return The google authenticated client (or null on error)
 */
export async function requestUserAuth(): Promise<CalendarClient> {
    const keyFile = await loadJSON<{ installed?: KeyFile, web?: KeyFile }>(CREDENTIALS_PATH)
    const keys = keyFile.installed || keyFile.web;
    if (!keys.redirect_uris || keys.redirect_uris.length === 0) {
        throw new Error("No valid redirect_uris provided.");
    }

    // create an oAuth client to authorize the API call
    const client = new OAuth2Client({
        clientId: keys.client_id,
        clientSecret: keys.client_secret,
    });

    const redirectUri = new URL(keys.redirect_uris[0] ?? 'http://localhost');
    if (redirectUri.hostname !== 'localhost') {
        throw new Error("No valid redirect_uris provided.");
    }

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

        const listenPort = Number(redirectUri.port)

        server.listen(listenPort, () => {
            const address = server.address() as AddressInfo;
            if (address.port !== undefined) {
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
 * Tries to authenticate to the Google Account using previously saved tokens
 *
 * @return The google authenticated client (or null on error)
 */
export async function authorize(): Promise<CalendarClient | null> {
    const keyFile = await loadJSON<{ installed?: KeyFile, web?: KeyFile }>(CREDENTIALS_PATH)
    const keys = keyFile.installed || keyFile.web;
    if (!keys.redirect_uris || keys.redirect_uris.length === 0) {
        throw new Error("No valid redirect_uris provided.");
    }

    // create an oAuth client to authorize the API call
    const client = new OAuth2Client({
        clientId: keys.client_id,
        clientSecret: keys.client_secret,
    });

    let jsonClient = await loadJSON<TokensFile>(TOKEN_PATH);
    if (jsonClient) {
        console.info('Found saved tokens.')
        client.setCredentials({
            access_token: jsonClient.access_token,
            refresh_token: jsonClient.refresh_token,
        });

        // tries first with the saved access_token
        try {
            const tokenInfo = await client.getTokenInfo(jsonClient.access_token);
            console.info('Access token is valid until', new Date(tokenInfo.expiry_date).toISOString());

            return client
        } catch (err) {
            console.log('Access token is invalid, refreshing token:', err);
        }

        // tries to get another access_token using the refresh_token
        try {
            const tokenResponse = await client.refreshAccessToken();
            client.setCredentials(tokenResponse.credentials);
            await saveCredentials(client);
            console.log('Access token refreshed successfully');
            return client
        } catch (refreshErr) {
            console.error('Error refreshing access token:', refreshErr);
        }
    }
    console.error('No possibility to log to the Google Account, you will need to reauthorized the application.')
    return null
}
