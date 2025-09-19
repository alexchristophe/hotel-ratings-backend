document.addEventListener('DOMContentLoaded', async () => {
  console.log('Hotel Bedding Ratings Popup: Initializing...');
  
  const form = document.getElementById('beddingRatingForm');
  const submitBtn = document.getElementById('submitBtn');
  const statusMessage = document.getElementById('statusMessage');
  const loadingMessage = document.getElementById('loadingMessage');

  let currentHotelInfo = null;
  let retryCount = 0;
  const maxRetries = 3;
  let browserFingerprint = null;

  // Generate browser fingerprint for abuse prevention
  function generateFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('Browser fingerprint', 2, 2);
      
      const fingerprint = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset(),
        canvas.toDataURL(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown'
      ].join('|');
      
      // Create a simple hash
      let hash = 0;
      for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      return Math.abs(hash).toString(36);
    } catch (error) {
      console.warn('Hotel Bedding Ratings Popup: Error generating fingerprint:', error);
      // Fallback fingerprint
      return 'fallback_' + Date.now().toString(36);
    }
  }

  // Initialize fingerprint
  browserFingerprint = generateFingerprint();
  console.log('Hotel Bedding Ratings Popup: Browser fingerprint generated:', browserFingerprint);

  // Function to display status messages
  function displayStatus(message, type) {
    statusMessage.innerHTML = message;
    statusMessage.className = type;
    statusMessage.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        statusMessage.style.display = 'none';
      }, 5000);
    }
  }

  // Function to validate URL
  function isValidBookingUrl(url) {
    if (!url) return false;
    return url.includes('booking.com/hotel/') || 
           url.includes('booking.com/Share-') ||
           (url.includes('booking.com') && url.includes('hotel'));
  }

  // Function to get hotel info with retry logic
  async function getHotelInfoWithRetry() {
    try {
      console.log(`Hotel Bedding Ratings Popup: Attempt ${retryCount + 1}/${maxRetries + 1}`);
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('No active tab found');
      }

      console.log('Hotel Bedding Ratings Popup: Current tab URL:', tab.url);

      if (!isValidBookingUrl(tab.url)) {
        loadingMessage.innerHTML = `
          <div style="text-align: center; color: #666;">
            <p><strong>⚠️ Not on a Booking.com hotel page</strong></p>
            <p>Please navigate to a hotel page on Booking.com to use this extension.</p>
            <p style="font-size: 12px; margin-top: 10px;">
              Current page: ${tab.url.length > 50 ? tab.url.substring(0, 50) + '...' : tab.url}
            </p>
            <div class="copyright-notice" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
              <small style="color: #888;">© All rights reserved Alex Christophe 2025</small>
            </div>
          </div>
        `;
        return false;
      }

      // Check if content script is loaded by trying to send a message
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getHotelInfo' });
      
      console.log('Hotel Bedding Ratings Popup: Response from content script:', response);

      if (response && response.success && response.hotelInfo) {
        currentHotelInfo = response.hotelInfo;
        console.log('Hotel Bedding Ratings Popup: Hotel info received:', currentHotelInfo);
        
        // Populate form fields
        document.getElementById('hotelName').value = currentHotelInfo.name || 'Unknown Hotel';
        document.getElementById('hotelAddress').value = currentHotelInfo.address || 'Address not found';
        document.getElementById('hotelKey').value = currentHotelInfo.hotelKey || '';
        
        loadingMessage.style.display = 'none';
        form.style.display = 'block';
        
        // Load existing ratings summary
        await loadRatingSummary();
        
        return true;
      } else {
        throw new Error('No hotel info received from content script');
      }
      
    } catch (error) {
      console.error('Hotel Bedding Ratings Popup: Error getting hotel info:', error);
      
      if (retryCount < maxRetries) {
        retryCount++;
        loadingMessage.innerHTML = `
          <div style="text-align: center; color: #666;">
            <p>Loading hotel information...</p>
            <p style="font-size: 12px;">Attempt ${retryCount}/${maxRetries + 1}</p>
          </div>
        `;
        
        // Wait 2 seconds before retry
        setTimeout(() => getHotelInfoWithRetry(), 2000);
        return false;
      } else {
        // All retries exhausted
        loadingMessage.innerHTML = `
          <div style="text-align: center; color: #dc3545;">
            <p><strong>⚠️ Could not load hotel information</strong></p>
            <p style="font-size: 14px; margin: 10px 0;">This could happen if:</p>
            <ul style="text-align: left; font-size: 12px; margin: 10px 0; padding-left: 20px;">
              <li>The page is still loading</li>
              <li>The content script failed to inject</li>
              <li>The hotel page structure has changed</li>
            </ul>
            <p style="font-size: 12px; color: #666;">
              Try refreshing the page and reopening the extension.
            </p>
            <div class="copyright-notice" style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
              <small style="color: #888;">© All rights reserved Alex Christophe 2025</small>
            </div>
          </div>
        `;
        return false;
      }
    }
  }

  // Function to load and display rating summary
  async function loadRatingSummary() {
    try {
      if (!currentHotelInfo || !currentHotelInfo.hotelKey) {
        return;
      }

      const API_BASE = 'https://hotel-ratings-backend.onrender.com';
      const response = await fetch(`${API_BASE}/ratings/summary/${currentHotelInfo.hotelKey}`);
      
      if (!response.ok) {
        console.warn('Hotel Bedding Ratings Popup: Could not load rating summary');
        return;
      }

      const summary = await response.json();
      console.log('Hotel Bedding Ratings Popup: Rating summary:', summary);

      // Find or create summary section
      let summarySection = document.getElementById('rating-summary-popup');
      if (!summarySection) {
        summarySection = document.createElement('div');
        summarySection.id = 'rating-summary-popup';
        summarySection.className = 'rating-summary-section';
        form.insertBefore(summarySection, form.firstChild);
      }

      if (summary.totalRatings === 0) {
        summarySection.innerHTML = `
          <div class="no-ratings-popup">
            <p><strong>No ratings yet</strong></p>
            <p>Be the first to rate this hotel's bedding!</p>
          </div>
        `;
        return;
      }

      // Build summary HTML
      let summaryHTML = `
        <div class="current-ratings">
          <h4>Current Ratings (${summary.totalRatings} total)</h4>
      `;

      const categories = [
        { key: 'bedSize', label: '🛏️ Bed Size' },
        { key: 'bedComfort', label: '🛏️ Bed Comfort' },
        { key: 'bedcoverSize', label: '🛌 Bed Cover Size' },
        { key: 'bedcoverComfort', label: '🛌 Bed Cover Comfort' },
        { key: 'pillowSize', label: '🪶 Pillow Size' },
        { key: 'pillowComfort', label: '🪶 Pillow Comfort' },
        { key: 'lightAnnoyances', label: '💡 Light Annoyances' }
      ];

      categories.forEach(category => {
        const data = summary[category.key];
        if (data && data.total > 0 && data.top2.length > 0) {
          summaryHTML += `<div class="category-summary-popup">
            <strong>${category.label}:</strong><br>
          `;
          
          data.top2.forEach((rating, index) => {
            const percentage = rating.percentage;
            const count = rating.count;
            const ratingText = formatRatingText(rating.rating);
            const colorClass = getRatingClass(rating.rating);
            
            summaryHTML += `<span class="rating-item-popup ${colorClass}">
              ${percentage}% ${ratingText} (${count})${index === 0 && data.top2.length > 1 ? ', ' : ''}
            </span>`;
          });
          
          summaryHTML += `</div>`;
        }
      });

      summaryHTML += '</div>';
      summarySection.innerHTML = summaryHTML;

    } catch (error) {
      console.error('Hotel Bedding Ratings Popup: Error loading rating summary:', error);
    }
  }

  // Helper functions for rating display
  function formatRatingText(rating) {
    const ratingMap = {
      'as-described': 'as described',
      'not-as-described': 'not as described',
      'too-soft': 'too soft',
      'soft': 'soft',
      'medium': 'medium',
      'hard': 'hard',
      'too-hard': 'too hard',
      'big-enough': 'big enough',
      'not-big-enough': 'not big enough',
      'too-hot': 'too hot',
      'synthetic-heat': 'synthetic heat',
      'natural-heat': 'natural heat',
      'just-right': 'just right',
      'too-cold': 'too cold',
      'too-low': 'too low',
      'nicely-judged': 'nicely judged',
      'too-high': 'too high',
      'ac-panel': 'AC panel',
      'telephone': 'telephone',
      'tv-dot': 'TV dot',
      'corridor-light': 'corridor light',
      'curtain-window': 'curtain/window',
      'smoke-alarm': 'smoke alarm'
    };
    return ratingMap[rating] || rating;
  }

  function getRatingClass(rating) {
    const positiveRatings = ['as-described', 'medium', 'big-enough', 'natural-heat', 'nicely-judged', 'just-right'];
    const negativeRatings = ['not-as-described', 'too-soft', 'too-hard', 'not-big-enough', 'too-hot', 'too-cold', 'too-low', 'too-high', 'ac-panel', 'telephone', 'tv-dot', 'corridor-light', 'curtain-window', 'smoke-alarm'];
    
    if (positiveRatings.includes(rating)) {
      return 'positive-rating';
    } else if (negativeRatings.includes(rating)) {
      return 'negative-rating';
    }
    return 'neutral-rating';
  }

  // Initialize hotel info loading
  await getHotelInfoWithRetry();

  // Handle form submission
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    console.log('Hotel Bedding Ratings Popup: Form submitted');
    
    // Clear previous status
    statusMessage.style.display = 'none';
    statusMessage.className = '';

    // Disable submit button and show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      // Validate hotel info
      if (!currentHotelInfo || !currentHotelInfo.hotelKey) {
        throw new Error('Hotel information is missing. Please refresh the page and try again.');
      }

      // Validate fingerprint
      if (!browserFingerprint) {
        throw new Error('Browser fingerprint could not be generated. Please try again.');
      }

      // Collect light annoyances data
      const lightAnnoyancesCheckboxes = document.querySelectorAll('input[name="lightAnnoyances"]:checked');
      const lightAnnoyances = Array.from(lightAnnoyancesCheckboxes).map(checkbox => checkbox.value);

      // Collect form data
      const ratingData = {
        hotelKey: currentHotelInfo.hotelKey,
        hotelName: currentHotelInfo.name,
        hotelAddress: currentHotelInfo.address,
        bedSize: document.getElementById('bedSize').value.trim(),
        bedComfort: document.getElementById('bedComfort').value.trim(),
        bedcoverSize: document.getElementById('bedcoverSize').value.trim(),
        bedcoverComfort: document.getElementById('bedcoverComfort').value.trim(),
        pillowSize: document.getElementById('pillowSize').value.trim(),
        pillowComfort: document.getElementById('pillowComfort').value.trim(),
        lightAnnoyances: lightAnnoyances, // Add new light annoyances array
        fingerprint: browserFingerprint, // Add fingerprint for rate limiting
        timestamp: new Date().toISOString()
      };

      console.log('Hotel Bedding Ratings Popup: Rating data:', ratingData);

      // Validate that at least one rating field is selected
      const ratingFields = ['bedSize', 'bedComfort', 'bedcoverSize', 'bedcoverComfort', 'pillowSize', 'pillowComfort'];
      const hasAtLeastOneRating = ratingFields.some(field => ratingData[field] && ratingData[field] !== '') || lightAnnoyances.length > 0;

      if (!hasAtLeastOneRating) {
        throw new Error('Please select at least one bedding rating or light annoyance before submitting.');
      }

      // Submit to backend - using Render deployment
      const API_BASE = 'https://hotel-ratings-backend.onrender.com';
      console.log('Hotel Bedding Ratings Popup: Submitting to:', `${API_BASE}/ratings`);
      
      const response = await fetch(`${API_BASE}/ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(ratingData)
      });

      console.log('Hotel Bedding Ratings Popup: Response status:', response.status);

      if (!response.ok) {
        let errorMessage = `Server error (${response.status})`;
        try {
          const errorBody = await response.json();
          
          // Handle rate limiting specifically
          if (response.status === 429) {
            const rateLimitMessage = errorBody.message || 'Rate limit exceeded';
            displayStatus(`⏰ <strong>Rate Limit Reached</strong><br>${rateLimitMessage}<br><small>You can submit another rating next week.</small>`, 'warning');
            return;
          }
          
          errorMessage = errorBody.error || errorMessage;
        } catch (e) {
          errorMessage = `${errorMessage}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('Hotel Bedding Ratings Popup: Success response:', result);

      // Show success message
      displayStatus('✅ <strong>Rating submitted successfully!</strong><br>Thank you for your feedback.', 'success');
      
      // Reset form after successful submission
      form.reset();
      
      // Reload rating summary to show updated data
      setTimeout(() => loadRatingSummary(), 1000);

    } catch (error) {
      console.error('Hotel Bedding Ratings Popup: Submission error:', error);
      
      let errorMessage = error.message;
      
      // Handle specific error types
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Cannot connect to the rating server. Please check your internet connection and try again.';
      } else if (error.message.includes('CORS')) {
        errorMessage = 'Server connection blocked. Please check CORS settings on the backend.';
      }
      
      displayStatus(`❌ ${errorMessage}`, 'error');
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Rating';
    }
  });

  // Add form validation feedback
  const selectElements = form.querySelectorAll('select');
  const checkboxElements = form.querySelectorAll('input[type="checkbox"]');
  
  [...selectElements, ...checkboxElements].forEach(element => {
    element.addEventListener('change', () => {
      // Clear any previous error messages when user starts selecting
      if (statusMessage.className === 'error') {
        statusMessage.style.display = 'none';
      }
    });
  });

  // Add copyright notice to the form
  const copyrightDiv = document.createElement('div');
  copyrightDiv.className = 'copyright-notice';
  copyrightDiv.innerHTML = '<small style="color: #888; text-align: center; display: block; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">© All rights reserved Alex Christophe 2025</small>';
  form.appendChild(copyrightDiv);

  console.log('Hotel Bedding Ratings Popup: Initialization complete');
});
