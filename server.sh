#!/bin/bash


echo "NOW YOU MUST PLAY THE GAME"
cat TODO.md

IP=$(ip addr show | grep -oP '192\.168\.88\.\d+' | head -1)

if [ -n "$IP" ]; then
    echo "Local IP: $IP"
    echo "Server:   http://$IP:8181"
else
    echo "Warning: no 192.168.88.x address found"
fi

echo ""
exec php -S 0.0.0.0:8181
