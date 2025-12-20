import re

# Read source file
with open('src/index.tsx', 'r') as f:
    content = f.read()

# Read modal HTML
with open('modal-inject.html', 'r') as f:
    modal_html = f.read()

# Define modal script functions (minified for injection)
modal_script = """
<script>
window.showConfirm=function(msg,title='Confirm'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-question-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-secondary">Cancel</button><button class="pro-btn pro-btn-primary">Confirm</button>';b.querySelectorAll('button')[0].onclick=()=>{m.classList.remove('show');r(false)};b.querySelectorAll('button')[1].onclick=()=>{m.classList.remove('show');r(true)};m.classList.add('show')})};
window.showAlert=function(msg,title='Notice'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-info-circle" style="color:#FFD700"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
window.showSuccess=function(msg,title='Success'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-check-circle" style="color:#28A745"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
window.showError=function(msg,title='Error'){return new Promise(r=>{const m=document.getElementById('proModal'),i=document.getElementById('proModalIcon'),t=document.getElementById('proModalTitle'),p=document.getElementById('proModalMsg'),b=document.getElementById('proModalBtns');i.innerHTML='<i class="fas fa-times-circle" style="color:#DC143C"></i>';t.textContent=title;p.textContent=msg;b.innerHTML='<button class="pro-btn pro-btn-primary">OK</button>';b.querySelector('button').onclick=()=>{m.classList.remove('show');r()};m.classList.add('show')})};
</script>
"""

# Replace simple alert() calls
content = content.replace(
    "alert('Please log in to continue booking');",
    "await showAlert('Please log in to continue booking', 'Login Required');"
)

content = content.replace(
    "alert('Please log in to continue booking.')",
    "await showAlert('Please log in to continue booking.', 'Login Required')"
)

content = content.replace(
    "alert('Please select a DJ first.');",
    "await showAlert('Please select a DJ first.', 'Selection Required');"
)

content = content.replace(
    "alert('Please select a date first.');",
    "await showAlert('Please select a date first.', 'Selection Required');"
)

content = content.replace(
    "alert('Please log in to continue.');",
    "await showAlert('Please log in to continue.', 'Login Required');"
)

content = content.replace(
    "alert('No booking data found. Please start from the beginning.');",
    "await showAlert('No booking data found. Please start from the beginning.', 'Error');"
)

content = content.replace(
    "alert('Please log in to continue with your booking.');",
    "await showAlert('Please log in to continue with your booking.', 'Login Required');"
)

content = content.replace(
    "alert('Your session has expired. Please log in again.');",
    "await showAlert('Your session has expired. Please log in again.', 'Session Expired');"
)

content = content.replace(
    "alert('Error: ' + error.message);",
    "await showError('Error: ' + error.message, 'Booking Error');"
)

content = content.replace(
    "alert('✅ Booking status updated successfully!')",
    "await showSuccess('Booking status updated successfully!', 'Success')"
)

content = content.replace(
    "alert('❌ Failed to update status: ' + response.data.error)",
    "await showError('Failed to update status: ' + response.data.error, 'Update Failed')"
)

content = content.replace(
    "alert('❌ Error updating status')",
    "await showError('Error updating status', 'Update Failed')"
)

# Replace confirm() for DJ booking
content = content.replace(
    "const shouldLogin = confirm('You need to be logged in to book a DJ. Would you like to log in now?');",
    "const shouldLogin = await showConfirm('You need to be logged in to book a DJ. Would you like to log in now?', 'Login Required');"
)

# Replace confirm() for photobooth booking
content = content.replace(
    "const shouldLogin = confirm('You need to be logged in to book a photobooth. Would you like to log in now?');",
    "const shouldLogin = await showConfirm('You need to be logged in to book a photobooth. Would you like to log in now?', 'Login Required');"
)

# Need to make DOMContentLoaded handlers async where confirm/alert used
content = content.replace(
    "window.addEventListener('DOMContentLoaded', () => {",
    "window.addEventListener('DOMContentLoaded', async () => {"
)

# Same for other event listeners that use alerts
content = re.sub(
    r"(continueToCalendar\(\)) {",
    r"\1 async {",
    content
)

print("Replacements completed!")
print("Saving to src/index.tsx...")

# Save modified content
with open('src/index.tsx', 'w') as f:
    f.write(content)

print("Done! File updated.")
print("\nNote: You still need to inject the modal HTML into pages manually.")
print("The modal HTML is already injected in DJ services page.")
