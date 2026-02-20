#!/usr/bin/env python3
"""Deploy Scorched Earth web app to berrry.app.

Usage:
    python3 deploy.py <NOMCP_URL>

Example:
    python3 deploy.py https://berrry.app/api/nomcp/brry_rw_XXXXX/
"""

import json
import os
import sys
import urllib.request

SUBDOMAIN = "scorched-earth"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def build_files():
    files = []

    # HTML files
    for fname in sorted(os.listdir(WEB_DIR)):
        if fname.endswith('.html'):
            files.append({
                "name": fname,
                "content": read_file(os.path.join(WEB_DIR, fname))
            })

    # CSS
    css_dir = os.path.join(WEB_DIR, "css")
    for fname in sorted(os.listdir(css_dir)):
        if fname.endswith('.css'):
            files.append({
                "name": f"css/{fname}",
                "content": read_file(os.path.join(css_dir, fname))
            })

    # All JS modules
    js_dir = os.path.join(WEB_DIR, "js")
    for fname in sorted(os.listdir(js_dir)):
        if fname.endswith('.js'):
            files.append({
                "name": f"js/{fname}",
                "content": read_file(os.path.join(js_dir, fname))
            })

    return files


def deploy(api_base):
    files = build_files()
    print(f"Deploying {len(files)} files to {SUBDOMAIN}.berrry.app ...")
    for f in files:
        print(f"  {f['name']} ({len(f['content'])} bytes)")

    payload = json.dumps({
        "subdomain": SUBDOMAIN,
        "files": files
    }).encode('utf-8')

    print(f"\nTotal payload: {len(payload)} bytes")

    # Try creating the app first
    url = f"{api_base}/apps"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            print(f"\nCreated: {json.dumps(result, indent=2)}")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f"\nPOST /apps returned {e.code}: {body}")

        # If app already exists, try PUT to update it
        if e.code in (409, 422, 400):
            print(f"\nApp already exists, updating...")
            return update(api_base, files)
        raise


def update(api_base, files):
    url = f"{api_base}/apps/{SUBDOMAIN}"
    payload = json.dumps({
        "files": files,
        "message": "Deploy with landing page and mobile touch controls"
    }).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="PUT"
    )

    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        print(f"\nUpdated: {json.dumps(result, indent=2)}")
        return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__.strip())
        sys.exit(1)

    api_url = sys.argv[1].rstrip('/')
    deploy(api_url)
