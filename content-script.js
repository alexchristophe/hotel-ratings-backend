// Chrome Extension Content Script for Hotel Bedding Ratings
// Extracts hotel information from Booking.com pages

console.log('🏨 Hotel Bedding Ratings: Content script loaded');
console.log('🏨 Current URL:', window.location.href);
console.log('🏨 Page title:', document.title);

class HotelBeddingRatings {
  constructor() {
    this.hotelInfo = null;
    this.backendUrl = 'https://hotel-ratings-backend.onrender.com';
    this.init();
  }

  init() {
    console.log('🏨 Hotel Bedding Ratings: Initializing...');
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
    
    this.setupMessageListener();
  }

  start() {
    console.log('🏨 Hotel Bedding Ratings: Starting extraction...');
    
    // Verify we're on a Booking.com hotel page
    if (!this.isBookingHotelPage()) {
      console.warn('🏨 Not on a Booking.com hotel page');
      return;
    }

    // Wait a bit for page to load, then extract
    setTimeout(() => {
      this.extractHotelInfo();
    }, 2000);
  }

  isBookingHotelPage() {
    const url = window.location.href;
    return url.includes('booking.com/hotel/') || 
           url.includes('booking.com/Share-') ||
           (url.includes('booking.com') && url.includes('.html'));
  }

  extractHotelInfo() {
    console.log('🏨 Hotel Bedding Ratings: Starting hotel info extraction...');
    
    let name = '';
    let address = '';

    try {
      // 1. Get hotel name from h2 element
      console.log('🏨 Looking for hotel name...');
      
      const h2Elements = document.querySelectorAll('h2');
      for (const h2 of h2Elements) {
        const text = h2.textContent?.trim();
        console.log(`🏨 Checking h2: "${text}"`);
        
        if (text && text.length > 5 && text.length < 200) {
          // Skip navigation and UI elements
          if (!text.toLowerCase().includes('booking') && 
              !text.toLowerCase().includes('search') &&
              !text.toLowerCase().includes('filter') &&
              !text.toLowerCase().includes('sort') &&
              !text.toLowerCase().includes('menu') &&
              !text.toLowerCase().includes('sign in') &&
              !text.toLowerCase().includes('register')) {
            name = text;
            console.log(`🏨 Found hotel name: "${name}"`);
            break;
          }
        }
      }

      // 2. Get address using Booking.com's consistent structure
      console.log('🏨 Looking for address using structure-based approach...');
      
      // Method 1: Look for address near location pin icon
      const locationSelectors = [
        '[data-testid="address"]',
        '[data-testid="property-address"]', 
        '.hp_address_subtitle',
        '.hp_address',
        '[aria-label*="address"]',
        '[class*="address"]',
        'span[data-testid*="address"]'
      ];
      
      for (const selector of locationSelectors) {
        const addressElement = document.querySelector(selector);
        if (addressElement) {
          const addressText = addressElement.textContent?.trim();
          if (addressText && addressText.length > 10) {
            address = addressText;
            console.log(`🏨 Found address via selector "${selector}": "${address}"`);
            break;
          }
        }
      }

      // Method 2: Look for elements containing location pin SVG and get nearby text
      if (!address) {
        console.log('🏨 Looking for address near location pin...');
        
        const svgElements = document.querySelectorAll('svg');
        for (const svg of svgElements) {
          // Check if this SVG looks like a location pin
          const svgContent = svg.innerHTML.toLowerCase();
          if (svgContent.includes('path') && (svgContent.includes('location') || svg.getAttribute('aria-label')?.includes('location'))) {
            console.log('🏨 Found location pin SVG');
            
            // Look for address text in nearby elements
            let parent = svg.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
              const addressCandidates = parent.querySelectorAll('span, div, p');
              for (const candidate of addressCandidates) {
                const text = candidate.textContent?.trim();
                if (text && text.length > 10 && text.length < 200) {
                  // Check if it looks like an address (has numbers, street indicators, etc.)
                  const hasNumbers = /\d/.test(text);
                  const hasComma = text.includes(',');
                  const excludeWords = ['guest', 'review', 'rating', 'book', 'price', 'night', 'room', 'available'];
                  const hasExcludeWord = excludeWords.some(word => text.toLowerCase().includes(word));
                  
                  if (hasNumbers && hasComma && !hasExcludeWord) {
                    address = text;
                    console.log(`🏨 Found address near location pin: "${address}"`);
                    break;
                  }
                }
              }
              if (address) break;
              parent = parent.parentElement;
            }
            if (address) break;
          }
        }
      }

      // Method 3: Look for structured data (JSON-LD)
      if (!address) {
        console.log('🏨 Looking for address in structured data...');
        
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            if (data.address) {
              if (typeof data.address === 'string') {
                address = data.address;
              } else if (data.address.streetAddress) {
                const addr = data.address;
                address = `${addr.streetAddress || ''}, ${addr.addressLocality || ''}, ${addr.postalCode || ''} ${addr.addressCountry || ''}`.replace(/,\s*,/g, ',').trim();
              }
              if (address) {
                console.log(`🏨 Found address in structured data: "${address}"`);
                break;
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      // Method 4: Look for address patterns in text content
      if (!address) {
        console.log('🏨 Looking for address patterns in page content...');
        
        const allElements = document.querySelectorAll('span, div, p');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          
          if (text && text.length > 15 && text.length < 300) {
            // Look for address patterns (street number + street name, postal codes, etc.)
            const hasStreetPattern = /\d+\s+[\w\s]+(straße|str\.|street|avenue|road|way|lane)/i.test(text);
            const hasPostalCode = /\b\d{4,5}\b/.test(text);
            const hasCommas = (text.match(/,/g) || []).length >= 1;
            
            // Exclude obvious non-address content
            const excludePatterns = [
              /review|guest|rating|book|price|night|room|available|excellent|good|bad|stay/i,
              /\d+\s*(euro|eur|€|\$|usd)/i,
              /\d+\s*(star|rating)/i
            ];
            
            const isExcluded = excludePatterns.some(pattern => pattern.test(text));
            
            if ((hasStreetPattern || hasPostalCode) && hasCommas && !isExcluded) {
              address = text.replace(/\s*[–-]\s*$/, '').trim();
              console.log(`🏨 Found address via pattern matching: "${address}"`);
              break;
            }
          }
        }
      }

      // Fallback for name from page title
      if (!name) {
        const pageTitle = document.title;
        if (pageTitle && !pageTitle.includes('Booking.com')) {
          const parts = pageTitle.split(',')[0].split(' - ')[0].split('(')[0];
          name = parts.trim();
          console.log(`🏨 Got name from page title: "${name}"`);
        }
      }

      // Set defaults if not found
      if (!name) {
        name = 'Hotel name not found';
      }
      if (!address) {
        address = 'Address not available';
      }

      // Generate hotelKey
      const normalizedName = name.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const normalizedAddress = address.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const hotelKey = btoa(normalizedName + '|' + normalizedAddress).replace(/[/+=]/g, '');

      this.hotelInfo = {
        name,
        address,
        hotelKey,
        url: window.location.href
      };

      console.log('🏨 Hotel Bedding Ratings: Final extracted info:', this.hotelInfo);
      
      // Create UI if we have valid info
      if (name !== 'Hotel name not found') {
        this.createRatingsUI();
      }

    } catch (error) {
      console.error('🏨 Hotel Bedding Ratings: Error extracting hotel info:', error);
      this.hotelInfo = { 
        name: 'Error extracting name', 
        address: 'Error extracting address',
        hotelKey: 'error',
        url: window.location.href
      };
    }
  }

  createRatingsUI() {
    try {
      // Remove existing container if present
      const existing = document.getElementById('hotel-bedding-ratings-container');
      if (existing) {
        existing.remove();
      }

      const ratingsContainer = document.createElement('div');
      ratingsContainer.id = 'hotel-bedding-ratings-container';
      ratingsContainer.className = 'hotel-bedding-ratings-container';
      
      // Simple UI
      ratingsContainer.innerHTML = `
        <div class="bedding-header">
          <h3>🛏️ Hotel Bedding Ratings</h3>
          <p><strong>Hotel:</strong> ${this.hotelInfo.name}</p>
          <p><strong>Address:</strong> ${this.hotelInfo.address}</p>
          
          <button class="submit-rating-btn" id="open-rating-popup">
            Submit Rating
          </button>
          <div class="copyright-notice">
            <small>© All rights reserved Alex Christophe 2025</small>
          </div>
        </div>
      `;

      // Add click handler
      const button = ratingsContainer.querySelector('#open-rating-popup');
      if (button) {
        button.addEventListener('click', () => {
          alert('Please click the extension icon in your browser toolbar to submit a rating.');
        });
      }

      // Append to body
      document.body.appendChild(ratingsContainer);
      console.log('🏨 Hotel Bedding Ratings: UI container created successfully');

    } catch (error) {
      console.error('🏨 Hotel Bedding Ratings: Error creating UI:', error);
    }
  }

  setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('🏨 Hotel Bedding Ratings: Received message:', request);
        
        if (request.action === 'getHotelInfo') {
          // If hotel info isn't extracted yet, try to extract it now
          if (!this.hotelInfo) {
            console.log('🏨 Hotel info not ready, extracting now...');
            this.extractHotelInfo();
          }
          
          console.log('🏨 Hotel Bedding Ratings: Sending hotel info:', this.hotelInfo);
          
          // Always send a response, even if hotelInfo is null
          const response = { 
            hotelInfo: this.hotelInfo,
            success: !!this.hotelInfo && this.hotelInfo.name !== 'Hotel name not found',
            url: window.location.href,
            timestamp: new Date().toISOString()
          };
          
          sendResponse(response);
          return true; // Keep message channel open for async response
        }
        
        return false;
      });
      
      console.log('🏨 Hotel Bedding Ratings: Message listener setup complete');
    } catch (error) {
      console.error('🏨 Hotel Bedding Ratings: Error setting up message listener:', error);
    }
  }
}

// Initialize
console.log('🏨 Hotel Bedding Ratings: Initializing...');
new HotelBeddingRatings();

