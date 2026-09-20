const GITHUB_API = "https://api.github.com";

function getConfig() {
    const {
        GITHUB_TOKEN,
        GITHUB_OWNER,
        GITHUB_REPO,
        GITHUB_FILE_PATH = "colors.json",
        GITHUB_BRANCH = "main"
    } = process.env;

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        throw new Error("GitHub environment variables are missing.");
    }

    return {
        token: GITHUB_TOKEN,
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: GITHUB_FILE_PATH,
        branch: GITHUB_BRANCH
    };
}

async function githubRequest(url, options = {}) {
    const config = getConfig();

    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${config.token}`,
            "X-GitHub-Api-Version": "2026-03-10",
            ...options.headers
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = {
            message: text
        };
    }

    if (!response.ok) {
        throw new Error(
            data.message || `GitHub API error: ${response.status}`
        );
    }

    return data;
}

async function getGithubFile() {
    const config = getConfig();

    const url =
        `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/` +
        `${config.path}?ref=${encodeURIComponent(config.branch)}`;

    const data = await githubRequest(url);

    const content = Buffer.from(
        data.content.replace(/\n/g, ""),
        "base64"
    ).toString("utf8");

    return {
        colors: JSON.parse(content),
        sha: data.sha
    };
}

async function updateGithubFile(colors, sha, message) {
    const config = getConfig();

    const content =
        JSON.stringify(colors, null, 2) + "\n";

    const encoded =
        Buffer.from(content, "utf8").toString("base64");

    const url =
        `${GITHUB_API}/repos/${config.owner}/${config.repo}/contents/` +
        config.path;

    return githubRequest(url, {
        method: "PUT",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            message,
            content: encoded,
            sha,
            branch: config.branch
        })
    });
}

function json(data, statusCode = 200) {
    return {
        statusCode,

        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        },

        body: JSON.stringify(data)
    };
}

exports.handler = async (event) => {
    try {
        const method = event.httpMethod;

        // =========================
        // GET
        // =========================

        if (method === "GET") {
            const { colors } = await getGithubFile();

            return json(colors);
        }

        // =========================
        // POST - ADD
        // =========================

        if (method === "POST") {
            const body = JSON.parse(event.body || "{}");

            const name = String(body.name || "").trim();
            const code = String(body.code || "").trim();

            if (!name) {
                return json(
                    {
                        error: "Color name is required."
                    },
                    400
                );
            }

            if (!code) {
                return json(
                    {
                        error: "Color code is required."
                    },
                    400
                );
            }

            const { colors, sha } =
                await getGithubFile();

            const duplicate = colors.some(
                color =>
                    String(color.code).toLowerCase() ===
                    code.toLowerCase()
            );

            if (duplicate) {
                return json(
                    {
                        error:
                            "This color code already exists."
                    },
                    409
                );
            }

            const newId =
                colors.length > 0
                    ? Math.max(
                        ...colors.map(
                            color => Number(color.id) || 0
                        )
                    ) + 1
                    : 1;

            const newColor = {
                id: newId,
                name,
                code
            };

            colors.push(newColor);

            await updateGithubFile(
                colors,
                sha,
                `Add color: ${name}`
            );

            return json(
                {
                    success: true,
                    color: newColor
                },
                201
            );
        }

        // =========================
        // PUT - EDIT
        // =========================

        if (method === "PUT") {
            const body = JSON.parse(event.body || "{}");

            const id = Number(body.id);
            const name = String(body.name || "").trim();
            const code = String(body.code || "").trim();

            if (!id) {
                return json(
                    {
                        error: "Color ID is required."
                    },
                    400
                );
            }

            if (!name) {
                return json(
                    {
                        error: "Color name is required."
                    },
                    400
                );
            }

            if (!code) {
                return json(
                    {
                        error: "Color code is required."
                    },
                    400
                );
            }

            const { colors, sha } =
                await getGithubFile();

            const index = colors.findIndex(
                color =>
                    Number(color.id) === id
            );

            if (index === -1) {
                return json(
                    {
                        error: "Color not found."
                    },
                    404
                );
            }

            const duplicate = colors.some(
                color =>
                    Number(color.id) !== id &&
                    String(color.code).toLowerCase() ===
                    code.toLowerCase()
            );

            if (duplicate) {
                return json(
                    {
                        error:
                            "This color code already exists."
                    },
                    409
                );
            }

            colors[index] = {
                id,
                name,
                code
            };

            await updateGithubFile(
                colors,
                sha,
                `Edit color: ${name}`
            );

            return json({
                success: true,
                color: colors[index]
            });
        }

        // =========================
        // DELETE
        // =========================

        if (method === "DELETE") {
            const id = Number(
                event.queryStringParameters?.id
            );

            if (!id) {
                return json(
                    {
                        error: "Color ID is required."
                    },
                    400
                );
            }

            const { colors, sha } =
                await getGithubFile();

            const color = colors.find(
                item =>
                    Number(item.id) === id
            );

            if (!color) {
                return json(
                    {
                        error: "Color not found."
                    },
                    404
                );
            }

            const newColors = colors.filter(
                item =>
                    Number(item.id) !== id
            );

            await updateGithubFile(
                newColors,
                sha,
                `Delete color: ${color.name}`
            );

            return json({
                success: true
            });
        }

        return json(
            {
                error: "Method not allowed."
            },
            405
        );

    } catch (error) {
        console.error(error);

        return json(
            {
                error:
                    error.message ||
                    "Internal server error."
            },
            500
        );
    }
};

exports.config = {
    path: "/api/colors"
};
