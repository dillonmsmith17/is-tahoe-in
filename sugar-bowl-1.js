
const nav_conditions_current_cam_url = 'https://sugar3.sugarbowl.com/graphics/webcams/nobhill/XMasTreeTop26-11-11_09-04-56-83_03308.jpg';
const nav_conditions_cam_name1		 = 'Mt. Disney';
const nav_conditions_cam_name2		 = 'East Face';
const nav_conditions_cam_date		 = '11/11/2026';
const nav_conditions_cam_time		 = '09:07 AM';
var nav_alert_header; //cant be const since it is assigned later
var navset;
var header_alert_type_sb;
var header_alert_type_rg;
var header_alert_link_sb;
var header_alert_link_rg;








header_alert_type_rg = "disabled";

header_alert_type_sb = "disabled";


header_alert_link_sb = "/18440";

header_alert_link_rg = "";








 
if ($('body').hasClass('rg')) 
{
navset = 'rg';
console.log('navset:', navset);
console.log('navset type:', header_alert_type_rg);
}
else
{
navset = 'sb';
console.log('navset:', navset);
console.log('navset type:', header_alert_type_sb);
}














if (navset == 'rg')
{
nav_alert_header = `
<div class="color_0001 alert_copy txt_0010" style="padding-right:20px; text-align:center">


<span class="txt_0010 b1"></span>


 


<span class="alert_learn_more txt_0010 b1 color_0001" style="position:relative;"> </span>
</div>
<span class="alert_view_more" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9" fill="none" style="transform: rotate(180deg)"><path d="M0.999446 8.53949L8.53906 0.999868L16.0787 8.53949" stroke="white"/></svg></span>
<span class="alert_hide" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9" fill="none"><path d="M0.999446 8.53949L8.53906 0.999868L16.0787 8.53949" stroke="white"/></svg></span>

`;
}
else
{
nav_alert_header = `




<div class="color_0001 alert_copy txt_0010" style="padding-right:20px; text-align:center">
Grab your season pass before prices increase on November 5th. 
<span class="alert_learn_more txt_0010 b1 color_0001" style="position:relative;">Shop Now » </span>
</div>
<span class="alert_view_more" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9" fill="none" style="transform: rotate(180deg)"><path d="M0.999446 8.53949L8.53906 0.999868L16.0787 8.53949" stroke="white"/></svg></span>
<span class="alert_hide" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9" fill="none"><path d="M0.999446 8.53949L8.53906 0.999868L16.0787 8.53949" stroke="white"/></svg></span>

`;
};


console.log('nav header', nav_alert_header);






