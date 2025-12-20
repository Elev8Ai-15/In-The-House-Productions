# Alert/Confirm Replacement Plan

## Found Instances:
1. Line 2162: alert('Please log in to continue booking');
2. Line 2175: confirm('You need to be logged in to book a DJ. Would you like to log in now?');
3. Line 2305: alert('Please log in to continue booking.');
4. Line 2313: alert('Please select a DJ first.');
5. Line 2479: alert('Please select a date first.');
6. Line 2752: alert('Please log in to continue.');
7. Line 2760: alert('No booking data found. Please start from the beginning.');
8. Line 2794: alert('Please log in to continue with your booking.');
9. Line 2839: alert('Your session has expired. Please log in again.');
10. Line 2876: alert('Error: ' + error.message);
11. Line 3149: alert('Please log in to continue booking');
12. Line 3162: confirm('You need to be logged in to book a photobooth. Would you like to log in now?');
13. Line 4231: alert('✅ Booking status updated successfully!')
14. Line 4234: alert('❌ Failed to update status: ' + response.data.error)
15. Line 4238: alert('❌ Error updating status')

## Strategy:
1. Create modal component as inline HTML/CSS/JS
2. Add to each page that has alerts/confirms
3. Replace all alert() with showAlert()
4. Replace all confirm() with showConfirm() (returns promise)
