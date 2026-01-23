# **Implementation Guide: Custom Domain Lightning Addresses (Breez SDK Spark)**

## **1\. Overview**

This document outlines the architecture and implementation steps required to register Lightning Addresses (e.g., user@customdomain.com) using the Breez SDK Nodeless (Spark) implementation.

The core mechanism relies on delegating the Lightning Address lookup protocol (LNURL) to Breez's hosted server (breez.tips), which handles the resolution of usernames to Lightning nodes.

## **2\. Infrastructure Configuration**

**Critical Decision:** Choose one of the following strategies based on domain requirements.

### **Strategy A: Subdomain (Recommended for Ease of Use)**

*Use this if the root domain hosts a website and you cannot modify server proxy rules.*

* **Target Format:** user@pay.yourdomain.com  
* **Implementation:**  
  1. Access DNS settings for yourdomain.com.  
  2. Create a **CNAME** record.  
     * **Host:** pay (or ln, sats)  
     * **Value:** breez.tips  
     * **TTL:** Automatic / 1 Hour

### **Strategy B: Root Domain (Reverse Proxy)**

*Use this if you require user@yourdomain.com and already host a website on the root domain.*

* **Target Format:** user@yourdomain.com  
* **Constraint:** You **cannot** use a CNAME on the root (@) without breaking the existing website. You must configure a reverse proxy to forward specific LNURL traffic.  
* **Implementation:** Route strictly the /.well-known/lnurlp/\* path to https://breez.tips.

#### **Configuration Examples:**

**Next.js (next.config.js):**

JavaScript

module.exports \= {  
  async rewrites() {  
    return \[  
      {  
        source: '/.well-known/lnurlp/:path\*',  
        destination: 'https://breez.tips/.well-known/lnurlp/:path\*',  
      },  
    \];  
  },  
};

**Nginx:**

Nginx

location /.well-known/lnurlp/ {  
    proxy\_pass https://breez.tips;  
    proxy\_set\_header Host breez.tips;  
    proxy\_ssl\_server\_name on;  
}

**Netlify (\_redirects):**

Plaintext

/.well-known/lnurlp/\* https://breez.tips/.well-known/lnurlp/:splat  200

## ---

**3\. SDK Integration Logic**

The application must initialize the Breez SDK with the specific domain configured in Section 2\.

### **A. Initialization**

When creating the Config object, the lnurl\_domain parameter must match the domain (or subdomain) routing to Breez.

TypeScript

import { defaultConfig, connect, NodeConfig, Network } from '@breeztech/breez-sdk-spark-react-native';

const apiKey \= process.env.BREEZ\_API\_KEY;

// 1\. Initialize Default Config  
let config \= await defaultConfig(Network.MAINNET, apiKey);

// 2\. Set Custom Domain  
// If using Strategy A: "pay.yourdomain.com"  
// If using Strategy B: "yourdomain.com"  
config.lnurlDomain \= "yourdomain.com";

// 3\. Connect  
const sdk \= await connect({  
    config: config,  
    mnemonic: process.env.MNEMONIC,  
});

### **B. Address Management**

Implement functions to check availability and register the address for the active user.

**Check Availability:**

TypeScript

async function checkUsername(username: string): Promise\<boolean\> {  
    try {  
        // Checks availability on the domain defined in config.lnurlDomain  
        const available \= await sdk.checkLightningAddressAvailable({ username });  
        return available;  
    } catch (e) {  
        console.error("Lookup failed:", e);  
        return false;  
    }  
}

**Register Address:**

TypeScript

async function registerAddress(username: string) {  
    try {  
        // Links 'username@yourdomain.com' to the current authenticated node  
        await sdk.registerLightningAddress({ username });  
        console.log(\`Success: ${username}@${config.lnurlDomain} registered.\`);  
    } catch (e) {  
        console.error("Registration failed:", e);  
        throw e;  
    }  
}

## ---

**4\. Verification & Testing**

1. **DNS Propagation:** Verify the CNAME or Proxy is active.  
   * *Command:* curl \-I https://yourdomain.com/.well-known/lnurlp/test-user  
   * *Expected Result:* You should receive a response from the Breez server (even if it's a 404 for a non-existent user, the headers should indicate the request reached the correct destination).  
2. **SSL:** Ensure the https handshake is valid. Breez handles SSL for breez.tips, but for Strategy B (Reverse Proxy), your own server must have a valid SSL certificate.

## **5\. References & Resources**

* **Integration Demo (Breez Team):** [How to Add Bitcoin Lightning Payments to Any App with the Breez SDK](https://www.youtube.com/watch?v=68yTli5qRTc)  
* **Live Environment Example:** [How to setup Breez SDK plugin in BTCpay Server](https://www.youtube.com/watch?v=OKSHjzy53Q0)