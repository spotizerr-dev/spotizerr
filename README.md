# SUPPORT YOUR ARTISTS

As of 2025, Spotify pays an average of $0.005 per stream to the artist. That means that if you give the equivalent of $5 directly to them (like merch, buying CDs, or just donating), you can """ethically""" listen to them a total of 1000 times. Of course, nobody thinks Spotify payment is fair, so preferably you should give more, but $5 is the bare minimum. Big names probably don't need those $5 dollars, but it might be _the_ difference between going out of business or not for that indie rock band you like.

# Spotizerr

A self-hosted music download manager with a lossless twist. Download everything from Spotify, and if it happens to also be on Deezer, download from there so you get those tasty FLACs.

## Why?

If you self-host a music server with other users than yourself, you almost certainly have realized that the process of adding requested items to the library is not without its friction. No matter how automated your flow is, unless your users are tech-savvy enough to do it themselves, chances are the process always needs some type of manual intervention from you, be it to rip the CDs yourself, tag some random files from youtube, etc. No more! Spotizerr allows for your users to access a nice little frontend where they can add whatever they want to the library without bothering you. What's that? You want some screenshots? Sure, why not:

<details>
  <summary>Main page</summary>
  <img width="393" height="743" alt="image" src="https://github.com/user-attachments/assets/f60e6c51-2ab2-4c4f-8572-a4c43e781758" />
</details>
<details>
  <summary>Search results</summary>
  <img width="385" height="740" alt="image" src="https://github.com/user-attachments/assets/0208e063-092e-4538-b092-5b1ede57fc58" />
</details>
<details>
  <summary>Track view</summary>
  <img width="1632" height="946" alt="image" src="https://github.com/user-attachments/assets/7a2f8240-a3ab-4b71-a772-f983d6bfd691" />
</details>
<details>
  <summary>Download history</summary>
  <img width="1588" height="994" alt="image" src="https://github.com/user-attachments/assets/e34d7dbb-29e3-4d75-bcbd-0cee03fa57dc" />
</details>

## How do I start?

Docs are available at: https://spotizerr.rtfd.io

### Common Issues

**Downloads not starting?**
- Check that service accounts are configured correctly
- Verify API credentials are valid
- Ensure sufficient storage space
- "No accounts available" error: Add credentials in settings

**Download failures?**
- Check credential validity and account status
- Audiokey related errors: Spotify rate limit, wait ~30 seconds and retry
- API errors: Ensure Spotify Client ID and Secret are correct

**Watch system not working?**
- Enable the watch system in settings
- Check watch intervals aren't too frequent
- Verify items are properly added to watchlist

**Authentication problems?**
- Check JWT secret is set
- Verify SSO credentials if using
- Clear browser cache and cookies

**Queue stalling?**
- Verify service connectivity
- Check for network issues

### Logs
Access logs via Docker:
```bash
docker logs spotizerr
```

**Log Locations:**
- Application Logs: `docker logs spotizerr` (main app and Celery workers)
- Individual Task Logs: `./logs/tasks/` (inside container, maps to your volume)
- Credentials: `./data/creds/`
- Configuration Files: `./data/config/`
- Downloaded Music: `./downloads/`
- Watch Feature Database: `./data/watch/`
- Download History Database: `./data/history/`
- Spotify Token Cache: `./.cache/` (if `SPOTIPY_CACHE_PATH` is mapped)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the GPL yada yada, see [LICENSE](LICENSE) file for details.

## ⚠️ Important Notes

- **Credentials stored in plaintext** - Secure your installation appropriately
- **Service limitations apply** - Account tier restrictions and geographic limitations

### Legal Disclaimer
This software is for educational purposes and personal use only. Ensure you comply with the terms of service of Spotify, Deezer, and any other services you use. Respect copyright laws and only download content you have the right to access.

### File Handling
- Downloaded files retain original metadata
- Service limitations apply based on account types

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## 🙏 Acknowledgements

This project was inspired by the amazing [deezspot library](https://github.com/jakiepari/deezspot). Although their creators are in no way related to Spotizerr, they still deserve credit for their excellent work.
